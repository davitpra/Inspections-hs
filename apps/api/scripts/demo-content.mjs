import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { COORDINATOR_ID, issueInvitation } from './bootstrap-invitation.mjs';
import { DEFAULT_PASSWORD, INSPECTOR, ST_THOMAS, currentPeriodStart } from './demo-data.mjs';

/**
 * EL HISTORIAL DE DEMO: lo que hace falta para que TODAS las pantallas del PWA tengan
 * algo que mostrar.
 *
 * `demo:data` deja el entorno *usable* —una cuenta que entra y la inspección del período
 * corriente asignada— y ahí se detiene a propósito. Con eso `/` tiene una fila y el resto
 * de la aplicación está en blanco: hallazgos, acciones correctivas e incidentes son
 * consecuencias de meses de trabajo que un entorno recién levantado no tuvo. Esto los
 * produce.
 *
 * TODO PASA POR LA API, CON SESIÓN, SALVO DOS EXCEPCIONES DECLARADAS (abajo). No es
 * purismo: la derivación de hallazgos, las notificaciones y la máquina de estados viven
 * en los servicios y en los triggers. Un script que escribiera las filas a mano
 * produciría un entorno que se ve
 * igual y se comporta distinto — y las diferencias aparecerían recién cuando alguien
 * intente reproducir un bug contra estos datos.
 *
 * LAS DOS EXCEPCIONES, las dos por la misma razón —no hay endpoint que pueda hacerlo, y
 * no debería haberlo—:
 *
 *   1. **Las inspecciones programadas de los meses pasados.** El planificador abre el
 *      período CORRIENTE (`inspections.open-period`); no existe forma de pedirle que
 *      abra marzo, y no tiene que existir. Se insertan por SQL, con los mismos GRANT de
 *      `hs_app` que usa `demo-data.mjs`.
 *   2. **Una acción correctiva ya vencida.** `due_at` se declara al crearla, así que
 *      por la API toda acción nace con plazo
 *      futuro y "vencida" y "escalada" serían dos estados que la UI tiene y nadie puede
 *      ver. Se inserta por SQL con su evento de apertura — que es lo que exige
 *      `hs_action_first_event_required` —, y el escalamiento lo produce solo el cron de
 *      la API, como en producción.
 *
 * IDEMPOTENTE, igual que `demo-data.mjs`: cada paso pregunta antes de escribir y la
 * segunda corrida no duplica nada. Los `client_submission_id` y los `draft_finding_id`
 * son derivados de un nombre fijo justamente para eso.
 *
 * REQUIERE LA API CORRIENDO y `pnpm demo:data` ya corrido.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

/** La cuenta que siembra `004_bootstrap_coordinator.sql`. */
const COORDINATOR_EMAIL = 'coordinator@example.com';

/**
 * QUÉ PASÓ CADA MES, contado desde el corriente hacia atrás.
 *
 * Cinco meses hacia atrás y no más: alcanzan para que el historial de hallazgos tenga
 * profundidad y cubren los estados operativos de la programación.
 *
 * `submitted` es un período cumplido, `cancelled` es uno cancelado con motivo y `missed`
 * es uno que nadie hizo y ya cerró. Así la consola de programación tiene estados variados.
 *
 * `negatives` son las respuestas «no» del envío, que es de donde salen los hallazgos:
 * la ingesta los deriva sola (`deriveFindings`), no se crean acá.
 *
 * `housekeeping.aisles-clear` en `packaging-line-1` se repite en los tres envíos A
 * PROPÓSITO: un mismo peligro que vuelve es lo que hace realista el listado de hallazgos
 * y el trabajo de acciones correctivas que sale de él.
 */
const HISTORY = [
  {
    monthsAgo: 5,
    outcome: 'submitted',
    negatives: [
      {
        itemKey: 'housekeeping.aisles-clear',
        location: 'packaging-line-1',
        description: 'Pallets and shrink wrap left across the main aisle by the packaging line.',
      },
      {
        itemKey: 'electrical.cords-undamaged',
        location: 'maintenance-shop',
        description: 'Extension cord to the bench grinder has cracked insulation near the plug.',
      },
    ],
  },
  {
    monthsAgo: 4,
    outcome: 'submitted',
    negatives: [
      {
        itemKey: 'housekeeping.aisles-clear',
        location: 'packaging-line-1',
        description: 'Same aisle blocked again with stacked pallets waiting to be wrapped.',
      },
    ],
  },
  { monthsAgo: 3, outcome: 'cancelled', reason: 'Plant shutdown for scheduled maintenance.' },
  {
    monthsAgo: 2,
    outcome: 'submitted',
    negatives: [
      {
        itemKey: 'housekeeping.aisles-clear',
        location: 'packaging-line-1',
        description: 'Aisle obstructed a third time; wrapped skids parked outside the marked bay.',
      },
      {
        itemKey: 'guards.emergency-stops',
        location: 'packaging-line-2',
        description: 'Emergency stop at the infeed station is behind a stack of empty totes.',
      },
    ],
  },
  { monthsAgo: 1, outcome: 'missed' },
];

/** El hallazgo de entrada manual: el peligro visto fuera de una inspección (§5 riesgo F). */
const MANUAL_FINDING = {
  location: 'boiler-room',
  description: 'Steam line insulation torn open at chest height beside the boiler room door.',
};

/**
 * Los incidentes. Tres, y cada uno existe para dejar una pantalla en un estado distinto:
 * uno cerrado sin investigar, uno en investigación con causas y acción abierta, y uno
 * recién reportado —que es el que tiene los relojes regulatorios corriendo y el que hace
 * que `/incidents/:id/form7` muestre algo—.
 */
const INCIDENTS = [
  {
    key: 'first-aid',
    employeeNumber: 'DEMO-1001',
    classification: 'first_aid',
    daysAgo: 40,
    location: 'shipping-dock',
    task_performed: 'Loading finished goods onto a trailer',
    equipment_involved: 'Manual pallet jack',
    what_happened: 'Worker scraped the back of the hand against the trailer door frame.',
    body_part: 'hand_or_finger',
    on_site_treatment: 'first_aid_on_site',
    immediate_action: 'Wound cleaned and dressed at the first aid station; worker resumed duties.',
    close_reason: 'First aid only, no lost time and no further treatment required.',
  },
  {
    key: 'lost-time',
    employeeNumber: 'DEMO-1002',
    classification: 'lost_time_or_modified_work',
    daysAgo: 18,
    location: 'packaging-line-2',
    task_performed: 'Clearing a jam at the case packer infeed',
    equipment_involved: 'Case packer infeed conveyor',
    what_happened: 'Worker slipped on wet floor beside the conveyor and landed on the left knee.',
    body_part: 'leg_or_knee',
    on_site_treatment: 'sent_to_clinic',
    immediate_action: 'Area cordoned off and the spill cleaned; worker driven to the clinic.',
    investigation: {
      method: 'five_whys',
      sequence_of_events:
        'The line was jammed, the operator stepped past the guarding to clear it, and the ' +
        'floor beside the conveyor was wet from condensation that had not been reported.',
      causes: [
        {
          statement: 'Condensation from the chiller line pooled beside the conveyor unnoticed.',
          is_root: false,
        },
        {
          statement:
            'No routine check assigns anyone to inspect the floor under the chiller line.',
          is_root: true,
        },
      ],
      action: {
        description:
          'Add the chiller line floor to the daily line check and install a drip tray under it.',
      },
    },
  },
  {
    key: 'critical',
    employeeNumber: 'DEMO-1003',
    classification: 'critical_injury',
    daysAgo: 2,
    location: 'maintenance-shop',
    task_performed: 'Changing the blade on the bench saw',
    equipment_involved: 'Bench saw',
    what_happened: 'The blade guard released while the saw was still coasting and struck the arm.',
    body_part: 'arm_or_elbow',
    on_site_treatment: 'emergency_services_called',
    immediate_action: 'Saw locked out, emergency services called, scene left undisturbed.',
  },
];

/**
 * La acción vencida: la excepción 2 de la cabecera. Se cuelga del hallazgo de
 * `electrical.cords-undamaged`, que es el más viejo del historial.
 */
const OVERDUE_ACTION = {
  description: 'Replace the damaged extension cord at the maintenance bench and tag the old one.',
  createdDaysAgo: 30,
  dueDaysAgo: 23,
};

/** Un JPEG de 1×1. ADR-001: lo que viaja en el envío son object keys, no bytes. */
const PIXEL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwg' +
    'JC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QA' +
    'HwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh' +
    'MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW' +
    'V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQF' +
    'BgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAV' +
    'YnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE' +
    'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq' +
    '8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  'base64',
);

// ---------------------------------------------------------------------------
// Utilidades

/**
 * Un uuid derivado de un nombre, estable entre corridas.
 *
 * Es lo que hace idempotentes las dos cosas que la API identifica por un id que elige el
 * cliente: `client_submission_id` —la clave de idempotencia del sistema entero, ADR-001—
 * y `draft_finding_id`. Con `randomUUID()` la segunda corrida crearía todo de nuevo.
 *
 * Los bits de versión y variante se fijan a mano: es un uuid v4 en la forma, derivado en
 * el contenido, y a los esquemas `z.uuid()` les alcanza con la forma.
 */
function uuidFrom(name) {
  const hex = createHash('sha256').update(`hs-demo:${name}`).digest('hex').slice(0, 32);
  const bytes = Buffer.from(hex, 'hex');

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const value = bytes.toString('hex');

  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20, 32),
  ].join('-');
}

/** `YYYY-MM-01` de `n` meses antes del período dado. */
function periodBefore(periodStart, months) {
  const [year, month] = periodStart.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 - months, 1));

  return shifted.toISOString().slice(0, 10);
}

/** El día 15 del período a las 14:00 de Ontario, que es cuando se caminó la planta. */
function signedAtOf(periodStart) {
  const [year, month] = periodStart.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, 15, 18, 0, 0)).toISOString();
}

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/**
 * Un pedido a la API. El error trae el cuerpo: un `400` de Zod sin su cuerpo no dice qué
 * campo estaba mal, y este script arma payloads grandes.
 */
async function request(method, path, { token, body } = {}) {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${method} ${path} respondió ${response.status}: ${await response.text()}`);
  }

  return response.status === 204 ? null : response.json();
}

/** Sube una foto: presign contra la API, PUT contra el bucket. Devuelve la object key. */
async function uploadPhoto(token, path, body) {
  const presigned = await request('POST', path, {
    token,
    body: { ...body, content_type: 'image/jpeg', content_length: PIXEL_JPEG.length },
  });

  const put = await fetch(presigned.url, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: PIXEL_JPEG,
  });

  if (!put.ok) {
    throw new Error(
      `El PUT contra el bucket respondió ${put.status}. ¿Está MinIO arriba (\`pnpm db:up\`) ` +
        'y `S3_ENDPOINT` apunta a él?',
    );
  }

  return presigned.object_key;
}

// ---------------------------------------------------------------------------
// Credenciales

/**
 * La credencial del coordinador, por la misma puerta que cualquier alta: invitación y
 * aceptación. Copia deliberada de `ensureCredential` de `demo-data.mjs` para el
 * coordinador — que es la cuenta que este script necesita, porque clasificar, abrir
 * acciones, investigar incidentes y generar el reporte de cumplimiento son todos suyos.
 */
async function ensureCoordinatorCredential(pool, password) {
  try {
    const invitation = await issueInvitation(pool, COORDINATOR_ID);

    await request('POST', '/auth/invitations/accept', {
      body: { token: invitation.token, password },
    });

    return false;
  } catch (error) {
    if (error.message.includes('ya tiene credencial')) return true;
    throw error;
  }
}

async function signIn(email, password) {
  const { session, tokens } = await request('POST', '/auth/sign-in', {
    body: { email, password },
  });

  return { session, token: tokens.accessToken };
}

/**
 * El mismo login, con el diagnóstico que el `401` no da.
 *
 * Las dos cuentas pueden tener YA una credencial puesta a mano —el coordinador la tiene
 * en cuanto alguien corrió `auth:bootstrap`— y en ese caso ni este comando ni `demo:data`
 * pueden cambiarla: una invitación no se emite sobre una cuenta que ya entró. Decirlo con
 * el comando exacto ahorra el rato que cuesta descubrir por qué "la contraseña de demo"
 * no es la contraseña.
 */
async function signInOrExplain(email, password, variable) {
  try {
    return await signIn(email, password);
  } catch (error) {
    // El bloqueo se ve casi igual que la contraseña equivocada —a propósito: si
    // respondiera distinto sería un oráculo— y la salida es otra. Sin este caso, cinco
    // corridas con la contraseña que no es dejan un error que dice "cambiala" cuando lo
    // que hay que hacer es esperar quince minutos o destrabarla.
    if (error.message.includes('account_locked')) {
      throw new Error(
        `La cuenta ${email} está trabada por intentos fallidos (quince minutos).\n` +
          `Para destrabarla sin tocar la credencial: pnpm auth:reset-password ${email} --unlock`,
      );
    }

    if (!error.message.includes('invalid_credentials')) throw error;

    throw new Error(
      `No se pudo entrar como ${email}.\n` +
        `Si esa cuenta ya tenía su propia contraseña, pasala en \`${variable}\` — este ` +
        'comando no la cambia.\n' +
        `Si se perdió: pnpm auth:reset-password ${email}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Lo que ya está en la base

/**
 * Las referencias del sitio: la plantilla vigente, el catálogo de ubicaciones y el roster.
 *
 * Bajo alcance declarado, y no con `pool.query` a secas: `location` y `person` llevan
 * `hs_apply_site_isolation` con FORCE, así que sin `app.site_ids` no devuelven una fila —
 * y "ninguna ubicación" se leería como "faltan los seeds", que es un diagnóstico
 * equivocado con la misma cara.
 */
async function readReferences(pool) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', ST_THOMAS]);

    const { rows: template } = await client.query(
      `SELECT v.id AS version_id, v.template_id
         FROM template_version v
         JOIN template t ON t.id = v.template_id
        WHERE t.key = 'monthly-general-inspection'
        ORDER BY v.version DESC
        LIMIT 1`,
    );

    const { rows: locations } = await client.query(
      'SELECT id, code FROM location WHERE site_id = $1 AND deactivated_at IS NULL',
      [ST_THOMAS],
    );

    const { rows: people } = await client.query(
      'SELECT id, employee_number FROM person WHERE site_id = $1',
      [ST_THOMAS],
    );

    await client.query('COMMIT');

    if (!template[0]) {
      throw new Error('No hay plantilla `monthly-general-inspection`. ¿Corriste `pnpm db:seed`?');
    }

    return {
      templateId: template[0].template_id,
      templateVersionId: template[0].version_id,
      locations: new Map(locations.map((row) => [row.code, row.id])),
      people: new Map(people.map((row) => [row.employee_number, row.id])),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** El documento de la versión congelada: de ahí salen las `item_key` de las respuestas. */
async function readTemplateItems(pool, templateVersionId) {
  const { rows } = await pool.query('SELECT document FROM template_version WHERE id = $1', [
    templateVersionId,
  ]);

  return rows[0].document.sections.flatMap((section) =>
    section.items.map((item) => item.item_key),
  );
}

// ---------------------------------------------------------------------------
// Los períodos pasados — excepción 1

/**
 * La inspección programada de un período pasado, insertada a mano.
 *
 * `scheduled_by` es el coordinador y no NULL: NULL es la marca de lo que abrió el
 * calendario, y esto no lo abrió el calendario. Que la fila diga la verdad sobre su
 * origen es gratis y evita que un reporte futuro cuente estas seis como automáticas.
 *
 * IDEMPOTENTE por consulta previa y no por `ON CONFLICT`: el único de la tabla es
 * PARCIAL (`WHERE cancelled_at IS NULL`), así que el período cancelado del historial no
 * lo cubriría y la segunda corrida abriría uno nuevo al lado.
 */
async function ensureScheduledInspection(pool, periodStart, references) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', ST_THOMAS]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', COORDINATOR_ID]);

    const { rows: existing } = await client.query(
      `SELECT id, cancelled_at FROM scheduled_inspection
        WHERE site_id = $1 AND period_start = $2`,
      [ST_THOMAS, periodStart],
    );

    if (existing[0]) {
      await client.query('COMMIT');
      return existing[0];
    }

    // `period_months` sale de la regla y no de un literal, igual que en `openPeriod()`
    // de `src/inspections/open-period.service.ts`: es la frecuencia declarada la que
    // define el período, y `period_end` es una columna generada a partir de ella. Un 1
    // escrito acá a mano sería correcto solo mientras la regla siga siendo mensual.
    const { rows } = await client.query(
      `INSERT INTO scheduled_inspection
         (site_id, period_start, period_months, template_id, template_version_id,
          inspector_id, scheduled_at, scheduled_by)
       SELECT $1, $2, s.frequency_months, $3, $4, $5, $2::date + INTERVAL '1 day', $6
         FROM inspection_schedule s
        WHERE s.site_id = $1
          AND s.template_id = $3
          AND s.deactivated_at IS NULL
       RETURNING id, cancelled_at`,
      [
        ST_THOMAS,
        periodStart,
        references.templateId,
        references.templateVersionId,
        INSPECTOR.accountId,
        COORDINATOR_ID,
      ],
    );

    if (!rows[0]) {
      throw new Error(
        `No hay regla activa para la plantilla ${references.templateId} en St. Thomas: ` +
          'corré `pnpm db:seed` antes de sembrar el historial.',
      );
    }

    await client.query('COMMIT');

    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cancelar, por el `GRANT UPDATE (cancelled_at, cancellation_reason)` de 0008 — que es
 * el único camino que `hs_app` tiene para hacerlo, y el mismo que usa el coordinador
 * desde la aplicación.
 */
async function cancelInspection(pool, inspectionId, reason) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', ST_THOMAS]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', COORDINATOR_ID]);

    await client.query(
      `UPDATE scheduled_inspection
          SET cancelled_at = now(), cancellation_reason = $2
        WHERE id = $1 AND cancelled_at IS NULL`,
      [inspectionId, reason],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Los envíos

/**
 * Un envío por la costura crítica 1: `POST /inspection-submissions`, con el inspector
 * asignado y con las fotos ya en el bucket.
 *
 * De acá salen SOLOS —porque los deriva la ingesta, no este script— los hallazgos de
 * cada respuesta negativa. Ese es el motivo entero de que esto vaya por la API.
 */
async function submitInspection(token, inspection, month, periodStart, references, itemKeys) {
  const negatives = new Map(month.negatives.map((entry) => [entry.itemKey, entry]));
  const answers = Object.fromEntries(itemKeys.map((key) => [key, !negatives.has(key)]));
  const findings = {};

  for (const [itemKey, negative] of negatives) {
    const locationId = references.locations.get(negative.location);

    if (locationId === undefined) {
      throw new Error(`No existe la ubicación \`${negative.location}\` en St. Thomas.`);
    }

    const objectKey = await uploadPhoto(token, '/uploads/presign', {
      scheduled_inspection_id: inspection.id,
      item_key: itemKey,
    });

    findings[itemKey] = {
      description: negative.description,
      location_id: locationId,
      photo_object_keys: [objectKey],
    };
  }

  // El reenvío no crea nada: `client_submission_id` es la clave de idempotencia y el
  // servidor devuelve el registro de la primera vez con `created: false`. Por eso no
  // hace falta preguntar antes si este período ya se envió.
  return request('POST', '/inspection-submissions', {
    token,
    body: {
      client_submission_id: uuidFrom(`submission:${periodStart}`),
      scheduled_inspection_id: inspection.id,
      template_version_id: references.templateVersionId,
      answers,
      photos: {},
      findings,
      signed_at: signedAtOf(periodStart),
    },
  });
}

// ---------------------------------------------------------------------------
// Hallazgo manual y acciones

/** El hallazgo de entrada manual, con su foto por el prefijo `manual/`. */
async function ensureManualFinding(token, references) {
  const findings = await request('GET', '/findings', { token });

  if (findings.some((finding) => finding.description === MANUAL_FINDING.description)) {
    return false;
  }

  const draftFindingId = uuidFrom('manual-finding');
  const objectKey = await uploadPhoto(token, '/uploads/presign/finding', {
    site_id: ST_THOMAS,
    draft_finding_id: draftFindingId,
  });

  await request('POST', '/findings', {
    token,
    body: {
      site_id: ST_THOMAS,
      draft_finding_id: draftFindingId,
      details: {
        description: MANUAL_FINDING.description,
        location_id: references.locations.get(MANUAL_FINDING.location),
        photo_object_keys: [objectKey],
      },
      occurred_at: daysAgo(6).toISOString(),
    },
  });

  return true;
}

/**
 * Una acción por cada estado del camino normal: abierta, en curso, esperando verificación
 * y cerrada. `in_progress` está en el camino desde ADR-021: dejó de ser el estado al que
 * solo se llegaba devolviendo un trabajo y pasó a ser la declaración explícita de que el
 * trabajo empezó, así que `open → awaiting_verification` ya no existe como par.
 *
 * QUIÉN HACE CADA PASO IMPORTA Y NO ES DECORATIVO. `awaiting_verification → closed` exige
 * `not_executor` —§3 R3, "una persona distinta del ejecutor"— y el motor lo comprueba en
 * `hs_action_verifier_guard`. Por eso el trabajo lo declara hecho el inspector, que es a
 * quien están asignadas, y lo verifica el coordinador. Con un solo actor no habría forma
 * de llegar a `closed` y la demo se quedaría sin la mitad interesante.
 */
async function seedActions(tokens) {
  const findings = await request('GET', '/findings', { token: tokens.coordinator });
  const actions = await request('GET', '/actions', { token: tokens.coordinator });
  const withAction = new Set(actions.map((action) => action.finding_id));

  const candidates = findings
    .filter((finding) => !withAction.has(finding.id))
    .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));

  // La descripción es la que identifica cada paso entre corridas. Sin esto, la segunda
  // corrida encontraría hallazgos todavía sin acción —los que la primera no alcanzó a
  // usar— y abriría otras tantas acciones sobre ellos.
  const already = new Set(actions.map((action) => action.description));

  const plan = [
    { state: 'open', description: 'Mark the aisle bay with floor tape and brief the line crew.' },
    {
      state: 'in_progress',
      description: 'Refit the missing guard on packaging line 2 and test the interlock.',
    },
    {
      state: 'awaiting_verification',
      description: 'Lag the exposed steam line and post a hot-surface sign at the doorway.',
    },
    {
      state: 'closed',
      description: 'Clear the blocked aisle and move the wrapping station out of the walkway.',
    },
  ];

  const created = [];
  let next = 0;

  for (const step of plan) {
    if (already.has(step.description)) continue;

    const finding = candidates[next];
    next += 1;

    if (finding === undefined) break;

    const action = await request('POST', `/findings/${finding.id}/actions`, {
      token: tokens.coordinator,
      body: {
        assignee_person_id: INSPECTOR.personId,
        description: step.description,
        due_at: daysAgo(-14).toISOString(),
      },
    });

    created.push({ id: action.id, state: step.state });

    if (step.state === 'open') continue;

    // Lo declara el asignado, que es quien empezó el trabajo. `open → in_progress` no
    // pide evidencia: la evidencia es del trabajo terminado, no del empezado.
    await request('POST', `/actions/${action.id}/transitions`, {
      token: tokens.inspector,
      body: { to: 'in_progress', note: 'Parts on hand; work started on the floor.' },
    });

    if (step.state === 'in_progress') continue;

    const objectKey = await uploadPhoto(tokens.inspector, '/uploads/presign/action', {
      action_id: action.id,
    });

    await request('POST', `/actions/${action.id}/transitions`, {
      token: tokens.inspector,
      body: {
        to: 'awaiting_verification',
        note: 'Work completed; photo of the finished condition attached.',
        evidence: [{ kind: 'after', object_key: objectKey }],
      },
    });

    if (step.state === 'awaiting_verification') continue;

    await request('POST', `/actions/${action.id}/transitions`, {
      token: tokens.coordinator,
      body: { to: 'closed', note: 'Verified on the floor; the walkway is clear and marked.' },
    });
  }

  return created;
}

/**
 * La acción vencida — excepción 2 de la cabecera.
 *
 * El evento de apertura va en la MISMA transacción y no es opcional:
 * `hs_action_first_event_required` es una restricción diferida a COMMIT, y una acción sin
 * eventos no existe («el estado es una consulta», ADR-002). `position` es 0 y `from_state`
 * NULL porque es el primero, que es exactamente lo que pide
 * `corrective_action_event_origin_check`.
 *
 * NO se inserta ningún escalamiento: lo escribe el cron de la API cuando pasa por acá, y
 * fabricarlo a mano sería inventar un hecho sobre un plazo en vez de dejar que el plazo
 * lo produzca.
 */
async function ensureOverdueAction(pool, token) {
  const findings = await request('GET', '/findings', { token });
  const finding = findings.find((entry) => entry.item_key === 'electrical.cords-undamaged');

  if (finding === undefined) return false;

  const actions = await request('GET', '/actions', { token });

  if (actions.some((action) => action.description === OVERDUE_ACTION.description)) return false;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', ST_THOMAS]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', COORDINATOR_ID]);

    const { rows } = await client.query(
      `INSERT INTO corrective_action
         (site_id, finding_id, assignee_person_id, description, due_at,
           created_by, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        ST_THOMAS,
        finding.id,
        INSPECTOR.personId,
        OVERDUE_ACTION.description,
         daysAgo(OVERDUE_ACTION.dueDaysAgo),
         COORDINATOR_ID,
        daysAgo(OVERDUE_ACTION.createdDaysAgo),
      ],
    );

    await client.query(
      `INSERT INTO corrective_action_event
         (action_id, site_id, position, from_state, to_state, actor_user_id, note, occurred_at)
       VALUES ($1, $2, 0, NULL, 'open', $3, $4, $5)`,
      [
        rows[0].id,
        ST_THOMAS,
        COORDINATOR_ID,
        'Opened after the monthly walkthrough.',
        daysAgo(OVERDUE_ACTION.createdDaysAgo),
      ],
    );

    await client.query('COMMIT');

    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Incidentes

/**
 * Los tres incidentes con su ciclo de vida.
 *
 * El reportante es el coordinador porque es la cuenta que este script tiene: §4 pone al
 * coordinador y a gerencia en la misma fila de la máquina de estados
 * (`INCIDENT_TRANSITIONS`, `from: null`), así que el registro es válido igual — lo que
 * cambia es quién figura, no qué se puede hacer con él.
 */
async function seedIncidents(token, references) {
  const existing = await request('GET', '/incidents', { token });
  const seen = new Set(existing.map((incident) => incident.what_happened));
  const created = [];

  for (const plan of INCIDENTS) {
    if (seen.has(plan.what_happened)) continue;

    const subjectId = references.people.get(plan.employeeNumber);

    if (subjectId === undefined) {
      throw new Error(
        `No existe la persona ${plan.employeeNumber} en St. Thomas. ¿Corriste \`pnpm demo:data\`?`,
      );
    }

    let incident = await request('POST', '/incidents', {
      token,
      body: {
        subject_person_id: subjectId,
        classification: plan.classification,
        occurred_at: daysAgo(plan.daysAgo).toISOString(),
        location_id: references.locations.get(plan.location),
        task_performed: plan.task_performed,
        equipment_involved: plan.equipment_involved,
        what_happened: plan.what_happened,
        body_part: plan.body_part,
        on_site_treatment: plan.on_site_treatment,
        immediate_action: plan.immediate_action,
        narrative_language: 'en',
        witness_person_ids: [references.people.get('DEMO-1004')].filter(Boolean),
      },
    });

    // Cerrar sin investigar: solo lo admiten las clasificaciones que no la obligan
    // (`investigation_optional`), y el motor lo comprueba igual.
    if (plan.close_reason !== undefined) {
      incident = await request('POST', `/incidents/${incident.id}/transitions`, {
        token,
        body: { to: 'closed', reason: plan.close_reason },
      });
    }

    if (plan.investigation !== undefined) {
      incident = await request('POST', `/incidents/${incident.id}/transitions`, {
        token,
        body: {
          to: 'under_investigation',
          method: plan.investigation.method,
          sequence_of_events: plan.investigation.sequence_of_events,
        },
      });

      for (const cause of plan.investigation.causes) {
        incident = await request('POST', `/incidents/${incident.id}/investigation/causes`, {
          token,
          body: cause,
        });
      }

      // La acción de la investigación queda ABIERTA a propósito: es la guarda
      // `no_open_actions` de §4 la que mantiene el incidente en investigación, y verla
      // funcionando vale más que un incidente cerrado de más.
      await request('POST', `/investigations/${incident.investigation.id}/actions`, {
        token,
        body: {
          assignee_person_id: INSPECTOR.personId,
          description: plan.investigation.action.description,
           due_at: daysAgo(-14).toISOString(),
        },
      });
    }

    created.push({ id: incident.id, state: incident.state });
  }

  return created;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('demo:content no corre con NODE_ENV=production. Siembra datos inventados.');
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL. Ver .env.example.');
  }

  // DOS CONTRASEÑAS Y NO UNA, y la segunda existe por una razón concreta: el coordinador
  // es una cuenta REAL del entorno —la crea el seed y su credencial la pone `auth:bootstrap`
  // a mano—, así que puede tener ya una que este comando no conoce y que NO le corresponde
  // pisar. `demo:data` crea al inspector, y por eso ahí sí alcanza con la de demo.
  //
  // La alternativa era resetear la del coordinador para que coincida, que es exactamente
  // lo que hay que no hacer: revoca la credencial y corta las sesiones vivas de alguien
  // que no pidió nada.
  const password = process.env.DEMO_PASSWORD ?? DEFAULT_PASSWORD;
  const coordinatorPassword = process.env.DEMO_COORDINATOR_PASSWORD ?? password;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const log = (line) => process.stdout.write(`${line}\n`);

  try {
    const coordinatorHadCredential = await ensureCoordinatorCredential(pool, coordinatorPassword);

    const inspector = await signInOrExplain(INSPECTOR.email, password, 'DEMO_PASSWORD');
    const coordinator = await signInOrExplain(
      COORDINATOR_EMAIL,
      coordinatorPassword,
      'DEMO_COORDINATOR_PASSWORD',
    );
    const tokens = { inspector: inspector.token, coordinator: coordinator.token };

    log(
      `Cuentas listas: ${INSPECTOR.email} (inspector) y ${COORDINATOR_EMAIL} ` +
        `(coordinator${coordinatorHadCredential ? ', ya tenía credencial' : ''}).`,
    );

    const references = await readReferences(pool);
    const itemKeys = await readTemplateItems(pool, references.templateVersionId);
    const currentPeriod = currentPeriodStart(new Date());

    // 1. El historial de períodos.
    for (const month of HISTORY) {
      const periodStart = periodBefore(currentPeriod, month.monthsAgo);
      const inspection = await ensureScheduledInspection(pool, periodStart, references);

      if (month.outcome === 'cancelled') {
        await cancelInspection(pool, inspection.id, month.reason);
        log(`  ${periodStart}  cancelado`);
        continue;
      }

      if (month.outcome === 'missed') {
        log(`  ${periodStart}  omitido`);
        continue;
      }

      const accepted = await submitInspection(
        tokens.inspector,
        inspection,
        month,
        periodStart,
        references,
        itemKeys,
      );

      log(
        `  ${periodStart}  ${accepted.created ? 'enviado' : 'ya estaba enviado'}` +
          ` (${month.negatives.length} hallazgo${month.negatives.length === 1 ? '' : 's'})`,
      );
    }

    // 2. Hallazgo manual.
    const manual = await ensureManualFinding(tokens.coordinator, references);

    log(`Hallazgos: ${manual ? '1 manual' : 'sin cambios'}.`);

    // 3. Acciones correctivas.
    const actions = await seedActions(tokens);
    const overdue = await ensureOverdueAction(pool, tokens.coordinator);

    log(
      `Acciones: ${actions.length} nuevas` +
        `${actions.length > 0 ? ` (${actions.map((action) => action.state).join(', ')})` : ''}` +
        `${overdue ? ', 1 vencida' : ''}.`,
    );

    // 4. Incidentes.
    const incidents = await seedIncidents(tokens.coordinator, references);

    log(
      `Incidentes: ${incidents.length} nuevos` +
        `${incidents.length > 0 ? ` (${incidents.map((incident) => incident.state).join(', ')})` : ''}.`,
    );

    process.stdout.write(
      [
        '',
        'Historial de demo listo. Con qué entrar en http://localhost:5173:',
        '',
        `  ${COORDINATOR_EMAIL} / ${coordinatorPassword}`,
        '    coordinator. Ve las dos plantas y TODAS las pantallas salvo el pendiente:',
        '    hallazgos, acciones e incidentes.',
        '',
        `  ${INSPECTOR.email} / ${password}`,
         '    inspector. La cuenta tiene la inspección del mes: `/` tiene la del mes',
        '    corriente, y de ahí salen preparar, capturar y revisar.',
        '',
        'La bandeja de espera (`/outbox`) vive en el dispositivo y no se puede sembrar:',
        'se llena al guardar un borrador sin conexión.',
        '',
      ].join('\n'),
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.exitCode = 1;
    process.stderr.write(`${error.message}\n`);
  });
}

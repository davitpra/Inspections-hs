# ADR-008 — Arquitectura del sistema

|                             |                                                             |
| --------------------------- | ------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                    |
| **Fecha**                   | 2026-08-06                                                  |
| **Supersede**               | —                                                           |
| **Superada por**            | —                                                           |
| **Referencias**             | `docs/requisitos-v1.2.md` §4; ADR-005, ADR-006, ADR-009     |
| **Changes que la consumen** | Todos. Define los límites de módulo de la API               |

## Topología de despliegue

Con ADR-009 resuelto (sin exigencia de residencia canadiense), la elección se hace por costo
operativo para un solo desarrollador.

```
  Dispositivo Android (PWA instalada)
        │  IndexedDB · outbox · service worker
        │
        ├──► [ CDN estático ]  bundle de apps/web
        │
        ├──► [ Object storage S3-compatible ]  fotos vía presigned PUT
        │
        └──► [ Contenedor: NestJS ]  ── [ PostgreSQL gestionado + PITR ]
                     │                          ▲
                     └── pg-boss ───────────────┘
                         (misma base, sin Redis)
```

Cuatro piezas. Ninguna opcional, ninguna de más.

| Pieza         | Elección                                              | Criterio                                     |
| ------------- | ------------------------------------------------------- | -------------------------------------------- |
| API           | Plataforma de contenedores (Railway, Render o Fly.io) | Playwright necesita Chromium: sin serverless |
| Base de datos | Postgres gestionado **con PITR**                      | Ver abajo                                    |
| Objetos       | S3-compatible con versioning (R2, B2, S3)             | Egress bajo, sin borrado desde la app        |
| Cliente       | CDN estático (Cloudflare Pages, Netlify)              | Es un bundle, no necesita servidor           |

**Región:** una sola, la más cercana a Ontario (`us-east` / Toronto según proveedor). No hay
requisito de multi-región ni de alta disponibilidad: 15 usuarios y una inspección al mes por
sitio toleran una ventana de mantenimiento.

## El backup es la mitad de la inmutabilidad

ADR-002 impide que la aplicación modifique el pasado. No impide que se pierda. Un sistema de
registro regulatorio sin recuperación punto-en-el-tiempo tiene inmutabilidad decorativa.

Requisitos mínimos, no negociables al elegir proveedor:

- PITR de al menos 7 días en la base de datos.
- Versioning activado en el bucket de objetos, sin credenciales de borrado en la app.
- Una restauración de prueba ejecutada **antes** de que el sistema tenga datos reales, y
  repetida una vez al año. Un backup no verificado no es un backup.

## Arquitectura de la API: monolito modular

Un solo desplegable, con módulos de NestJS que corresponden a contextos del dominio de
`docs/requisitos-v1.2.md` §4. Nada de microservicios: no hay equipo que los justifique ni
carga que los pida.

| Módulo        | Responsabilidad                                                       |
| ------------- | ----------------------------------------------------------------------- |
| `identity`    | Persona, Usuario, roles, importación CSV del roster (pregunta 3)      |
| `catalog`     | Sitios y catálogo cerrado de ubicaciones (pregunta 1)                 |
| `templates`   | Builder, versionado, `item_key`, publicación como documento congelado |
| `inspections` | InspecciónProgramada, ingesta de envíos, congelamiento                |
| `findings`    | Hallazgos, clasificación de riesgo, jerarquía de controles            |
| `actions`     | Acciones correctivas, transiciones como eventos, escalamientos        |
| `incidents`   | Incidentes en tercera persona, investigación, relojes regulatorios    |
| `audit`       | Log append-only y cadena de hashes                                    |
| `reporting`   | Recurrencia, cumplimiento por período, exportación a PDF              |

**Dependencias en una sola dirección.** `findings` conoce `inspections`; `inspections` no
conoce `findings`. `reporting` lee de todos y no lo llama nadie. Si aparece un ciclo, hay un
módulo mal recortado.

**Excepción declarada, agregada al implementar la etapa 4.** La ingesta del envío —costura
crítica 1, más abajo— importa la derivación de hallazgos desde `findings`, así que ahí
`inspections` sí conoce `findings`. No es un módulo mal recortado y no es un ciclo:
`findings` no llama a `inspections` en ningún punto, y la flecha va en una sola dirección
igual, solo que en la contraria a la que este párrafo suponía.

El motivo es que la lista de pasos de la costura es **una transacción**, no una secuencia de
llamadas entre servicios: derivar el hallazgo después del commit es exactamente lo que la
transacción existe para impedir. Componer los dos módulos en ese punto es la consecuencia de
esa decisión, y esconderla detrás de un puerto con un solo implementador la haría más difícil
de leer sin cambiar quién depende de quién en la práctica.

La regla que sigue en pie, y es la que importa: **`findings` no puede llamar a `inspections`**.
El día que haga falta, hay un ciclo y hay un módulo mal recortado.

## Las dos costuras críticas

Todo lo demás del sistema es CRUD con permisos. Estas dos concentran el riesgo y merecen el
código más cuidado del proyecto.

**1. La ingesta del envío** (`POST /inspections/submissions`). Una transacción, idempotente
por `client_submission_id`:

```
verificar idempotencia
  → validar respuestas contra la template_version (packages/forms)
  → insertar Inspección congelada
  → insertar Respuestas
  → derivar Hallazgos de las respuestas negativas
  → escribir eventos de auditoría encadenados
  → commit
```

Todo o nada. Si algo falla, el dispositivo reintenta con el mismo ID y no queda un estado
parcial. Este endpoint es el punto de no retorno de R1 y es donde el sistema puede corromper
un registro legal.

**2. La derivación de estado.** El estado de una acción correctiva y los relojes regulatorios
de un incidente **no son columnas**: se calculan a partir de eventos y de reglas.

Esas reglas viven en funciones puras, sin base de datos, en el módulo correspondiente:
máquina de estados de la acción, cálculo de fecha límite por severidad, ventanas de
escalamiento +3/+7, relojes del MLITSD y del WSIB. Testeables en milisegundos, sin
Testcontainers, con tabla de casos.

## Capas dentro del módulo

Deliberadamente delgadas: `controller → service → repository (Drizzle)`, más un archivo de
funciones puras de dominio donde haya reglas reales. Sin agregados, sin repositorios
genéricos, sin capa de mapeo. La complejidad del proyecto está en el builder y en el offline;
gastarla en ceremonia de arquitectura es exactamente el error que el documento de requisitos
advierte en el riesgo B.

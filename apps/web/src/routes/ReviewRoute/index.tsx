import { countAnsweredBySection, validateAnswers } from '@hs/forms';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import {
  AlertCircleIcon,
  CameraIcon,
  CheckCircleIcon,
  InfoIcon,
  LockIcon,
} from '../../components/icons';
import { UnsyncedIndicator } from '../../components/UnsyncedIndicator';
import {
  captureEligibility,
  documentForDraft,
  findDraft,
  incompleteFindings,
  loadDraft,
  signDraft,
} from '../../offline/drafts';
import { countPending } from '../../offline/photos';
import { enqueue, isQueued, runOutbox } from '../../offline/outbox';
import { storedTemplateVersion } from '../../offline/prefetch';
import { draftStatusLabel, draftStatusPill, draftSubtitle } from '../../presentation/drafts';
import {
  blockers,
  coverageLabel,
  pendingPhotosNote,
  signFailure,
  stopsLabel,
  verdict,
} from './presentation';

/**
 * Revisar y firmar. Es el momento en que un borrador deja de ser un borrador.
 *
 * La validación es `validateAnswers` de `@hs/forms`, la misma que el servidor corre. Si
 * pasa acá y el servidor la rechaza, el bug es de la versión del paquete y no de una
 * regla que alguien reimplementó del lado del cliente — que es la razón entera de
 * ADR-007.
 *
 * LA PANTALLA SE LEE DE ARRIBA A ABAJO Y TERMINA EN EL BOTÓN, en este orden: contra qué
 * inspección estoy parado, puedo firmar o no, qué me falta, qué estoy por firmar, y recién
 * entonces firmar. Es el orden de las preguntas que trae quien llega acá, y también el que
 * deja el punto de no retorno al final —donde una advertencia todavía sirve de algo— en vez
 * de repartir la decisión entre avisos sueltos a media página.
 */
export function ReviewRoute(): React.JSX.Element {
  const { id } = useParams({ from: '/inspections/$id/review' });
  const { account } = useAppSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const draft = useQuery({
    queryKey: queryKeys.draft(id, account?.userId),
    enabled: Boolean(account),
    queryFn: async () => {
      const row = account ? await findDraft(id, account.userId) : undefined;

      return row ? loadDraft(row.client_submission_id) : null;
    },
  });

  const document = useQuery({
    queryKey: queryKeys.document(draft.data?.draft.client_submission_id),
    enabled: Boolean(draft.data),
    queryFn: async () => (draft.data ? documentForDraft(draft.data.draft) : null),
  });

  /**
   * Spec offline-capture: "A draft whose inspection is no longer the account's cannot
   * be signed". Se compara contra lo mismo que `CaptureRoute` usa para decidir si
   * abrir (design D5): el `inspector_id` del payload guardado, nunca una lectura
   * fresca — si hubiera red para eso, ya la habría para descargar de nuevo. Un
   * dispositivo sin la descarga —`stored` en `undefined`— no bloquea (design D4).
   *
   * La misma fila da el nombre de la plantilla del encabezado: es una sola lectura, y la
   * clave es la que ya comparten la captura y la asignación destacada.
   */
  const stored = useQuery({
    queryKey: queryKeys.storedTemplateVersion(id),
    queryFn: () => storedTemplateVersion(id),
  });

  const eligibility = account
    ? captureEligibility(stored.data?.inspector_id, account.userId)
    : 'ok';

  /**
   * Firmar, encolar, intentar, y **contar lo que efectivamente pasó**.
   *
   * El destino depende del resultado y no es fijo. Mandar siempre al outbox convertía el
   * caso feliz —hay red, el envío salió en el acto, `accept` borró la fila— en una cola
   * vacía que no menciona la inspección que se acaba de firmar: la pantalla decía
   * "nothing is waiting" cuando la única pregunta del inspector era qué pasó con lo suyo.
   * La cola es el destino correcto solo cuando quedó algo en ella.
   */
  const submit = useMutation({
    mutationFn: async (): Promise<'accepted' | 'queued' | null> => {
      if (!draft.data) return null;
      if (eligibility !== 'ok') return null;

      const { client_submission_id } = draft.data.draft;

      await signDraft(client_submission_id);
      await enqueue(client_submission_id);

      // Uno de los tres disparadores del outbox (7.7): al terminar una inspección. Si no
      // hay red, la entrada queda en cola y sale al volver — no se pierde.
      //
      // La cuenta va explícita: la cola manda solo lo de su dueño, y acá el dueño es
      // quien acaba de firmar.
      await runOutbox({ accountId: account?.userId ?? null });

      return (await isQueued(client_submission_id)) ? 'queued' : 'accepted';
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) }),
    /**
     * Se navega en `onSuccess` y no en `onSettled`: si `signDraft` lanzó —un hallazgo
     * que quedó incompleto entre esta pantalla y el clic—, no se firmó nada, y sacar al
     * inspector de acá le esconde el único lugar donde puede arreglarlo. Se queda, y el
     * botón vuelve a estar disponible.
     */
    onSuccess: async (outcome) => {
      if (outcome === null) return;

      if (outcome === 'queued') {
        await navigate({ to: '/outbox' });
        return;
      }

      await navigate({ to: '/', search: { submitted: 'accepted' } });
    },
  });

  if (!draft.data || !document.data) {
    return (
      <p className="status-card">
        <InfoIcon size={20} /> Loading…
      </p>
    );
  }

  const validation = validateAnswers(document.data, draft.data.answers);
  const pendingPhotos = countPending(draft.data.photos);
  const submitted = draft.data.draft.status !== 'capturing';

  /**
   * R2 — no se firma con un hallazgo incompleto, y se NOMBRA lo que falta.
   *
   * `signDraft` lo vuelve a comprobar y lanza si algo cambió entre esta pantalla y el
   * clic; lo de acá es para que el inspector sepa a qué ítem volver mientras todavía
   * puede caminar hasta él.
   */
  const incomplete = incompleteFindings(
    document.data,
    draft.data.answers,
    draft.data.findings,
    draft.data.photos,
  );

  /**
   * Las dos comprobaciones, una sola lista y en orden de recorrido: para el inspector no
   * son "violaciones de validación" y "hallazgos incompletos", son las paradas que le
   * quedan. El texto lo arma `presentation.ts`; acá solo se pinta.
   */
  const blocking = blockers(document.data, validation.ok ? [] : validation.violations, incomplete);
  const state = verdict(blocking.length);

  /**
   * La cobertura por sección, con el MISMO conteo que la pantalla de captura muestra en
   * cada cabecera. Sale del motor y no de acá: la regla de qué ítem se ve y cuál cuenta es
   * la que decide si la inspección está completa, y escribirla otra vez sería un número
   * que puede discrepar del que habilita firmar.
   */
  const sections = countAnsweredBySection(document.data, draft.data.answers);
  const answered = sections.reduce((sum, section) => sum + section.answered, 0);
  const total = sections.reduce((sum, section) => sum + section.total, 0);

  return (
    <>
      {/*
        Fuera de `.review` a propósito: es `position: sticky` y se pega al borde de arriba
        del contenido, no al de una columna con su propio espaciado.
      */}
      <UnsyncedIndicator accountId={account?.userId ?? null} />

      <div className="review">
        <nav className="review__nav" aria-label="Inspection navigation">
          <Link className="back-link" to="/inspections/$id/capture" params={{ id }}>
            Back to the walkthrough
          </Link>
        </nav>

        {/*
          El encabezado nombra QUÉ se está por firmar. La pantalla decía solo "Review and
          sign": en el punto de no retorno, la primera pregunta es contra qué inspección se
          está parado, y la respuesta —la plantilla y desde cuándo— la resuelve el paquete
          guardado, sin red (ADR-001). La píldora es la misma del recorrido, así que el
          borrador se llama igual antes y después de contestar.
        */}
        <header className="scheduling__header review__header">
          <div className="scheduling__title">
            <h1>Review and sign</h1>
            <span className={draftStatusPill(draft.data.draft.status)}>
              {draftStatusLabel(draft.data.draft.status)}
            </span>
          </div>
          {stored.data ? (
            <p className="scheduling__subtitle">
              {draftSubtitle(stored.data.template_name, draft.data.draft.created_at)}
            </p>
          ) : null}
        </header>

        {eligibility !== 'ok' ? (
          <p className="notice notice--warn" role="alert">
            {eligibility === 'unassigned'
              ? 'This inspection no longer has an inspector assigned.'
              : 'This inspection is now assigned to someone else.'}{' '}
            Your answers stay on this device, but they can no longer be submitted.
          </p>
        ) : null}

        {/*
          EL VEREDICTO, ANTES QUE EL DETALLE. Es la única pregunta con la que se llega —
          ¿puedo firmar?— y antes había que deducirla de una frase suelta o de un aviso
          ámbar que ocupaban el mismo lugar de la página. Verde y rojo no alcanzan solos:
          el ícono acompaña a un título que ya lo dice en palabras.
        */}
        <section
          className={
            blocking.length === 0
              ? 'review__verdict review__verdict--ready'
              : 'review__verdict review__verdict--blocked'
          }
          aria-labelledby="review-verdict-title"
        >
          <span className="review__verdict-icon" aria-hidden>
            {blocking.length === 0 ? <CheckCircleIcon size={22} /> : <AlertCircleIcon size={22} />}
          </span>
          <div>
            <h2 className="review__verdict-title" id="review-verdict-title">
              {state.title}
            </h2>
            <p className="review__verdict-text">{state.text}</p>
          </div>
        </section>

        {blocking.length > 0 ? (
          <section className="card review__stops" aria-labelledby="review-stops-title">
            <div className="card__head">
              <h2 id="review-stops-title">What is left</h2>
              <span className="status-pill status-pill--not-ready">
                {stopsLabel(blocking.length)}
              </span>
            </div>

            {/*
              Numerada y no con viñetas: son las paradas que le quedan al inspector, en el
              orden en que va a caminarlas, y el número le sirve para saber cuántas van.

              La pregunta primero y en negrita, la sección debajo, y qué hacer al final: es
              el orden en que la busca —"¿cuál pregunta?", "¿dónde estaba?", "¿qué hago?"—.
              La `item_key` no aparece salvo que el documento no traiga la pregunta, en cuyo
              caso es lo único que hay para nombrar el ítem.
            */}
            <ol className="review__stop-list">
              {blocking.map((entry, index) => (
                <li key={entry.item_key} className="review__stop">
                  <span className="review__stop-number" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="review__stop-body">
                    <p className="review__stop-label">{entry.label}</p>
                    {entry.section ? (
                      <p className="review__stop-section">{entry.section}</p>
                    ) : null}
                    <ul className="review__stop-reasons">
                      {entry.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>

            {/*
              La salida al pie de la lista y no solo arriba: quien termina de leer diez
              paradas está en el final de la lista, y volver a subir para encontrar el link
              es el paso que sobra.
            */}
            <div className="card__footer">
              <Link className="back-link" to="/inspections/$id/capture" params={{ id }}>
                Back to the walkthrough
              </Link>
            </div>
          </section>
        ) : null}

        {/*
          QUÉ SE ESTÁ POR FIRMAR. La pantalla se llama "Review and sign" y de revisar no
          tenía nada: con todo contestado eran una frase y un botón. La cobertura por
          sección es lo que se revisa —dónde estuve y cuánto contesté ahí— y se muestra
          también cuando algo bloquea, porque una parada pendiente no vuelve irrelevante el
          resto del recorrido.
        */}
        <section className="card review__coverage" aria-labelledby="review-coverage-title">
          <div className="card__head">
            <h2 id="review-coverage-title">What you are signing</h2>
            {/*
              La píldora va NEUTRA y sin modificador de estado: es un conteo, no un
              veredicto. En verde, "3 of 10 answered" se leería como que está bien, y quien
              dice si está bien es el bloque de arriba.
            */}
            <span className="status-pill">{coverageLabel(answered, total)}</span>
          </div>

          {sections.length === 0 ? (
            <p className="note">This form has no sections.</p>
          ) : (
            <ul className="grid--list">
              {sections.map((section) => (
                <li key={section.section_key} className="section-row">
                  <span className="section-row__title">{section.section_title}</span>
                  <span className="section-row__count">
                    {section.answered} / {section.total} items
                  </span>
                </li>
              ))}
            </ul>
          )}

          {pendingPhotos > 0 ? (
            <p className="review__photos">
              <CameraIcon size={18} />
              <span>{pendingPhotosNote(pendingPhotos)}</span>
            </p>
          ) : null}
        </section>

        {/*
          La firma, en su propio bloque y al final. Es el punto de no retorno (ADR-001), y
          separarlo del resto es lo que impide que el botón quede como un control más
          colgado del final de una lista.
        */}
        <section className="card review__sign" aria-labelledby="review-sign-title">
          <h2 className="review__sign-title" id="review-sign-title">
            {submitted ? 'Signed and queued' : 'Sign this inspection'}
          </h2>

          {/*
           * El aviso va ACÁ —pegado al botón y antes de tocarlo— porque es el último
           * momento en que la advertencia sirve de algo. Dicho después, en la pantalla del
           * outbox, sería una explicación de por qué ya no se puede hacer nada.
           *
           * Nombra la salida que todavía existe, no solo la que se cierra: descartar el
           * borrador desde la pantalla de inicio. Un aviso que solo dice "esto es
           * irreversible" deja al inspector sin saber cuál era la alternativa.
           */}
          <p className="review__sign-note">
            <LockIcon size={18} />
            {submitted ? (
              /*
               * Ya firmada. Se llega acá volviendo a esta URL, no firmando —firmar navega—,
               * y sin esta línea la tarjeta era un título y un botón apagado: nada que
               * dijera dónde quedó el trabajo. Se nombra la cola, que es donde está.
               */
              <span>
                This inspection is signed. It leaves this device from the outbox as soon as
                there is a connection, and it can no longer be deleted from here.
              </span>
            ) : (
              <span>
                Signing is the point of no return. Until you sign, you can discard this draft
                from the list on the home screen. Once signed, the inspection is queued to be
                sent and can no longer be deleted from this device.
              </span>
            )}
          </p>

          {/*
           * QUE FALLE FIRMAR TENÍA QUE VERSE, Y NO SE VEÍA.
           *
           * `signDraft` lanza si un hallazgo quedó incompleto entre esta pantalla y el clic
           * —la comprobación que corre de nuevo contra las filas, no contra el documento—.
           * La mutación se quedaba acá a propósito, pero sin decir nada: el inspector
           * tocaba "Sign and submit", el botón se rehabilitaba, y la pantalla quedaba
           * igual. Un error silencioso en el punto de no retorno se lee como "no pasó
           * nada", que es exactamente lo contrario de lo que hay que entender.
           *
           * `submit.reset()` en el botón limpia el aviso al reintentar, para que un mensaje
           * viejo no se lea como el resultado del intento nuevo.
           */}
          {submit.isError ? (
            <p className="notice notice--warn" role="alert">
              This inspection was not signed. {signFailure(submit.error)}
            </p>
          ) : null}

          {/*
            La acción de la pantalla, y la única: `button--primary` —relleno de marca, ancho
            entero— porque firmar es a lo que se vino, y el punto de no retorno no se toca
            por accidente buscando cuál de dos botones era. Deshabilitado gana igual
            `button:disabled`, así que "Signed" y la espera se siguen leyendo apagados.
          */}
          <button
            type="button"
            className="button--primary"
            disabled={blocking.length > 0 || submitted || submit.isPending || eligibility !== 'ok'}
            onClick={() => {
              submit.reset();
              submit.mutate();
            }}
          >
            {submitted ? 'Signed' : 'Sign and submit'}
          </button>
        </section>
      </div>
    </>
  );
}

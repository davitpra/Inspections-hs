import { validateAnswers } from '@hs/forms';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
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
import { blockers, signFailure } from './presentation';

/**
 * Revisar y firmar. Es el momento en que un borrador deja de ser un borrador.
 *
 * La validación es `validateAnswers` de `@hs/forms`, la misma que el servidor corre. Si
 * pasa acá y el servidor la rechaza, el bug es de la versión del paquete y no de una
 * regla que alguien reimplementó del lado del cliente — que es la razón entera de
 * ADR-007.
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

  if (!draft.data || !document.data) return <p>Loading…</p>;

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

  return (
    <>
      <UnsyncedIndicator accountId={account?.userId ?? null} />

      <h1>Review and sign</h1>

      {eligibility !== 'ok' ? (
        <p className="notice notice--warn">
          {eligibility === 'unassigned'
            ? 'This inspection no longer has an inspector assigned.'
            : 'This inspection is now assigned to someone else.'}{' '}
          Your answers stay on this device, but they can no longer be submitted.
        </p>
      ) : null}

      {blocking.length === 0 ? (
        <p>Everything required has been answered.</p>
      ) : (
        <>
          <p className="notice notice--warn">
            {blocking.length} item{blocking.length === 1 ? '' : 's'} still need
            {blocking.length === 1 ? 's' : ''} your attention before you can sign:
          </p>

          {/*
            La pregunta primero y en negrita, la sección debajo, y qué hacer al final: es
            el orden en que el inspector la busca —"¿cuál pregunta?", "¿dónde estaba?",
            "¿qué hago?"—. La `item_key` no aparece salvo que el documento no traiga la
            pregunta, en cuyo caso es lo único que hay para nombrar el ítem.
          */}
          <ul className="list">
            {blocking.map((entry) => (
              <li key={entry.item_key} className="list__row list__row--stacked">
                <p>
                  <strong>{entry.label}</strong>
                </p>
                {entry.section ? <p className="list__aside">{entry.section}</p> : null}
                {entry.reasons.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}

      {pendingPhotos > 0 ? (
        <p className="notice">
          {pendingPhotos} photo{pendingPhotos === 1 ? '' : 's'} still to upload. They upload
          before the submission is sent — you can sign now and they will go out together when
          there is a connection.
        </p>
      ) : null}

      <p>
        <Link to="/inspections/$id/capture" params={{ id }}>
          Back to the walkthrough
        </Link>
      </p>

      {/*
       * Firmar es el punto de no retorno (ADR-001), y el aviso va ACÁ —pegado al botón y
       * antes de tocarlo— porque es el último momento en que la advertencia sirve de
       * algo. Dicho después, en la pantalla del outbox, sería una explicación de por qué
       * ya no se puede hacer nada.
       *
       * Nombra la salida que todavía existe, no solo la que se cierra: descartar el
       * borrador desde la pantalla de inicio. Un aviso que solo dice "esto es
       * irreversible" deja al inspector sin saber cuál era la alternativa.
       */}
      {!submitted ? (
        <p className="notice">
          Signing is the point of no return. Until you sign, you can discard this draft from
          the list on the home screen. Once signed, the inspection is queued to be sent and can
          no longer be deleted from this device.
        </p>
      ) : null}

      {/*
       * QUE FALLE FIRMAR TENÍA QUE VERSE, Y NO SE VEÍA.
       *
       * `signDraft` lanza si un hallazgo quedó incompleto entre esta pantalla y el clic
       * —la comprobación que corre de nuevo contra las filas, no contra el documento—.
       * La mutación se quedaba acá a propósito, pero sin decir nada: el inspector tocaba
       * "Sign and submit", el botón se rehabilitaba, y la pantalla quedaba igual. Un
       * error silencioso en el punto de no retorno se lee como "no pasó nada", que es
       * exactamente lo contrario de lo que hay que entender.
       *
       * `submit.reset()` en el botón limpia el aviso al reintentar, para que un mensaje
       * viejo no se lea como el resultado del intento nuevo.
       */}
      {submit.isError ? (
        <p className="notice notice--warn">
          This inspection was not signed. {signFailure(submit.error)}
        </p>
      ) : null}

      <button
        type="button"
        disabled={blocking.length > 0 || submitted || submit.isPending || eligibility !== 'ok'}
        onClick={() => {
          submit.reset();
          submit.mutate();
        }}
      >
        {submitted ? 'Signed' : 'Sign and submit'}
      </button>
    </>
  );
}

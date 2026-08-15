import { FINDING_DESCRIPTION_MIN } from '@hs/contracts';
import { validateAnswers } from '@hs/forms';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';

import { queryKeys } from '../api/query-keys';
import { useAppSession } from '../app/session-context';
import { UnsyncedIndicator } from '../components/UnsyncedIndicator';
import {
  captureEligibility,
  documentForDraft,
  findDraft,
  incompleteFindings,
  loadDraft,
  signDraft,
  type IncompleteFinding,
} from '../offline/drafts';
import { countPending } from '../offline/photos';
import { enqueue, runOutbox } from '../offline/outbox';
import { storedTemplateVersion } from '../offline/prefetch';

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

  const submit = useMutation({
    mutationFn: async () => {
      if (!draft.data) return;
      if (eligibility !== 'ok') return;

      const { client_submission_id } = draft.data.draft;

      await signDraft(client_submission_id);
      await enqueue(client_submission_id);

      // Uno de los tres disparadores del outbox (7.7): al terminar una inspección. Si no
      // hay red, la entrada queda en cola y sale al volver — no se pierde.
      //
      // La cuenta va explícita: la cola manda solo lo de su dueño, y acá el dueño es
      // quien acaba de firmar.
      await runOutbox({ accountId: account?.userId ?? null });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) });
      await navigate({ to: '/outbox' });
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

      {validation.ok ? (
        <p>Everything required has been answered.</p>
      ) : (
        <>
          <p className="notice notice--warn">This inspection is not complete yet:</p>
          <ul className="list">
            {validation.violations.map((violation) => (
              <li key={`${violation.item_key}-${violation.code}`} className="list__row">
                {violation.item_key}: {violation.code}
              </li>
            ))}
          </ul>
        </>
      )}

      {incomplete.length > 0 ? (
        <>
          <p className="notice notice--warn">
            These findings still need details before you can sign:
          </p>
          <ul className="list">
            {incomplete.map((entry) => (
              <li key={entry.item_key} className="list__row">
                {entry.item_key}: {entry.missing.map(readableMissing).join(', ')}
              </li>
            ))}
          </ul>
        </>
      ) : null}

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

      <button
        type="button"
        disabled={
          !validation.ok ||
          incomplete.length > 0 ||
          submitted ||
          submit.isPending ||
          eligibility !== 'ok'
        }
        onClick={() => submit.mutate()}
      >
        {submitted ? 'Signed' : 'Sign and submit'}
      </button>
    </>
  );
}

/**
 * Lo que le falta al hallazgo, en el idioma del inspector.
 *
 * "missing description" cuando ya escribió "ok" lo manda a buscar un campo que para él
 * está lleno. Nombrar el caso corto aparte es la diferencia entre volver al ítem
 * sabiendo qué hacer y volver a mirarlo sin entender.
 */
function readableMissing(missing: IncompleteFinding['missing'][number]): string {
  switch (missing) {
    case 'description':
      return 'missing description';
    case 'description_too_short':
      return `description shorter than ${FINDING_DESCRIPTION_MIN} characters`;
    case 'location':
      return 'missing location';
    case 'photo':
      return 'missing photo';
  }
}

import { validateAnswers } from '@hs/forms';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';

import { useAppSession } from '../app/session-context';
import { UnsyncedIndicator } from '../components/UnsyncedIndicator';
import {
  documentForDraft,
  findDraft,
  incompleteFindings,
  loadDraft,
  signDraft,
} from '../offline/drafts';
import { countPending } from '../offline/photos';
import { enqueue, runOutbox } from '../offline/outbox';

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
    queryKey: ['draft', id, account?.userId],
    enabled: Boolean(account),
    queryFn: async () => {
      const row = account ? await findDraft(id, account.userId) : undefined;

      return row ? loadDraft(row.client_submission_id) : null;
    },
  });

  const document = useQuery({
    queryKey: ['document', draft.data?.draft.client_submission_id],
    enabled: Boolean(draft.data),
    queryFn: async () => (draft.data ? documentForDraft(draft.data.draft) : null),
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!draft.data) return;

      const { client_submission_id } = draft.data.draft;

      await signDraft(client_submission_id);
      await enqueue(client_submission_id);

      // Uno de los tres disparadores del outbox (7.7): al terminar una inspección. Si no
      // hay red, la entrada queda en cola y sale al volver — no se pierde.
      await runOutbox();
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['draft', id] });
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
                {entry.item_key}: missing {entry.missing.join(', ')}
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

      <button
        type="button"
        disabled={!validation.ok || incomplete.length > 0 || submitted || submit.isPending}
        onClick={() => submit.mutate()}
      >
        {submitted ? 'Signed' : 'Sign and submit'}
      </button>
    </>
  );
}

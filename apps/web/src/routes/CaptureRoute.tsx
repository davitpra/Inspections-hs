import {
  evaluateVisibility,
  itemsInDocumentOrder,
  negativeAnswers,
  sectionsInDocumentOrder,
  validateAnswers,
  type TemplateDocument,
} from '@hs/forms';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { queryKeys } from '../api/query-keys';
import { useAppSession } from '../app/session-context';
import { FindingFields } from '../components/FindingFields';
import { ItemInput } from '../components/ItemInput';
import { UnsyncedIndicator } from '../components/UnsyncedIndicator';
import {
  documentForDraft,
  loadDraft,
  openDraft,
  saveAnswer,
  saveFinding,
  setCurrentItem,
} from '../offline/drafts';
import type { FindingDraftRow } from '../offline/db';
import { capturePhoto, discardPhoto } from '../offline/photos';
import { missingForField, storedLocations, storedTemplateVersion } from '../offline/prefetch';
import { readableKind } from './PendingRoute';

/**
 * La captura. Todo lo que pasa acá pasa sin red.
 *
 * El documento es el CONGELADO que bajó la descarga previa, y la visibilidad, la
 * obligatoriedad y la validez salen de `@hs/forms` — el mismo código que el servidor
 * corre al recibir el envío (ADR-007). El cliente no tiene una segunda opinión sobre si
 * la inspección está completa.
 */
export function CaptureRoute(): React.JSX.Element {
  const { id } = useParams({ from: '/inspections/$id/capture' });
  const { account, ready } = useAppSession();
  const queryClient = useQueryClient();

  const missing = useQuery({
    queryKey: queryKeys.fieldReady(id),
    queryFn: () => missingForField(id),
  });

  const draft = useQuery({
    queryKey: queryKeys.draft(id, account?.userId),
    enabled: Boolean(account) && missing.data?.length === 0,
    queryFn: async () => {
      const stored = await storedTemplateVersion(id);
      if (!stored || !account) return null;

      const row = await openDraft({
        scheduled_inspection_id: id,
        account_id: account.userId,
        site_id: stored.site_id,
        template_version_id: stored.template_version_id,
      });

      return loadDraft(row.client_submission_id);
    },
  });

  const document = useQuery({
    queryKey: queryKeys.document(draft.data?.draft.client_submission_id),
    enabled: Boolean(draft.data),
    queryFn: async () => (draft.data ? documentForDraft(draft.data.draft) : null),
  });

  const answer = useMutation({
    mutationFn: async (input: { itemKey: string; value: unknown; document: TemplateDocument }) => {
      if (!draft.data) return;

      // Se escribe ACÁ, antes de que la pantalla siguiente se pinte. Sin debounce: la
      // ventana que un debounce abre es exactamente la ventana en la que Android mata
      // el proceso.
      await saveAnswer(
        draft.data.draft.client_submission_id,
        input.itemKey,
        input.value,
        input.document,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) }),
  });

  const photo = useMutation({
    mutationFn: async (input: { itemKey: string; blob: Blob; kind?: 'answer' | 'finding' }) => {
      if (!draft.data) return;

      await capturePhoto({
        client_submission_id: draft.data.draft.client_submission_id,
        item_key: input.itemKey,
        blob: input.blob,
        kind: input.kind,
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) }),
  });

  /** La lista cerrada que bajó la descarga previa. Sin red y sin texto libre. */
  const locations = useQuery({
    queryKey: queryKeys.locations(id),
    queryFn: () => storedLocations(id),
  });

  const finding = useMutation({
    mutationFn: async (input: {
      itemKey: string;
      patch: Partial<Pick<FindingDraftRow, 'description' | 'location_id'>>;
    }) => {
      if (!draft.data) return;

      await saveFinding(draft.data.draft.client_submission_id, input.itemKey, input.patch);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) }),
  });

  const removePhoto = useMutation({
    mutationFn: (photoId: string) => discardPhoto(photoId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) }),
  });

  if (!ready) return <p>Loading…</p>;

  /**
   * Spec: "Capture on a device that is not field-ready is refused". No se empieza a
   * capturar a medias: se nombra qué falta y que hace falta conexión.
   */
  if (missing.isSuccess && missing.data.length > 0) {
    return (
      <>
        <h1>Not ready for the field</h1>
        <p className="notice notice--warn">
          This inspection is missing {missing.data.map(readableKind).join(', ')}. Capture cannot
          start until it is downloaded, and downloading needs a connection.
        </p>
        <p>
          <Link to="/inspections/$id/prepare" params={{ id }}>
            Prepare this inspection
          </Link>
        </p>
      </>
    );
  }

  if (!draft.data || !document.data) return <p>Loading the inspection…</p>;

  const { answers, photos, findings } = draft.data;
  const readOnly = draft.data.draft.status === 'accepted';
  const visibility = evaluateVisibility(document.data, answers);
  // La MISMA función que corre en el servidor (ADR-007). Si el dispositivo pidiera
  // detalles para un conjunto de ítems y el servidor esperara otro, el inspector
  // recorrería la planta, firmaría, y el envío volvería rechazado.
  const negative = new Set(negativeAnswers(document.data, answers));
  const validation = validateAnswers(document.data, answers);
  const violations = validation.ok ? [] : validation.violations;

  return (
    <>
      {/* Presente en TODA pantalla de captura, con o sin red (ADR-010). */}
      <UnsyncedIndicator accountId={account?.userId ?? null} />

      <h1>Walkthrough</h1>

      {readOnly ? (
        <p className="notice">
          This inspection has been submitted and accepted. It is shown read-only.
        </p>
      ) : null}

      {sectionsInDocumentOrder(document.data).map(([section, items]) => {
        const visibleItems = items.filter((item) => visibility[item.item_key]);
        if (visibleItems.length === 0) return null;

        return (
          <section key={section.section_key}>
            <h2>{section.section_title}</h2>

            {visibleItems.map((item) => (
              <div
                key={item.item_key}
                className="item"
                onFocus={() => void setCurrentItem(draft.data!.draft.client_submission_id, item.item_key)}
              >
                <label htmlFor={`item-${item.item_key}`}>
                  {item.prompt}
                  {item.required ? <span aria-hidden="true"> *</span> : null}
                </label>

                <fieldset disabled={readOnly}>
                  <ItemInput
                    item={item}
                    value={answers[item.item_key]}
                    invalid={violations.some((violation) => violation.item_key === item.item_key)}
                    photos={photos.filter(
                      (row) => row.item_key === item.item_key && row.kind === 'answer',
                    )}
                    onChange={(value) =>
                      answer.mutate({ itemKey: item.item_key, value, document: document.data! })
                    }
                    onCapturePhoto={(blob) => photo.mutate({ itemKey: item.item_key, blob })}
                    onDiscardPhoto={(photoId) => removePhoto.mutate(photoId)}
                  />

                  {negative.has(item.item_key) ? (
                    <FindingFields
                      itemKey={item.item_key}
                      finding={findings.find((row) => row.item_key === item.item_key)}
                      photos={photos.filter(
                        (row) => row.item_key === item.item_key && row.kind === 'finding',
                      )}
                      locations={locations.data ?? []}
                      disabled={readOnly}
                      onChange={(patch) => finding.mutate({ itemKey: item.item_key, patch })}
                      onCapturePhoto={(blob) =>
                        photo.mutate({ itemKey: item.item_key, blob, kind: 'finding' })
                      }
                      onDiscardPhoto={(photoId) => removePhoto.mutate(photoId)}
                    />
                  ) : null}
                </fieldset>
              </div>
            ))}
          </section>
        );
      })}

      <p>
        <Link to="/inspections/$id/review" params={{ id }}>
          Review and sign ({countAnswered(document.data, answers)} answered)
        </Link>
      </p>
    </>
  );
}

function countAnswered(document: TemplateDocument, answers: Record<string, unknown>): number {
  const visibility = evaluateVisibility(document, answers);

  return itemsInDocumentOrder(document).filter(
    (item) => visibility[item.item_key] && answers[item.item_key] !== undefined,
  ).length;
}

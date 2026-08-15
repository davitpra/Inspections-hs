import {
  evaluateVisibility,
  negativeAnswers,
  sectionsInDocumentOrder,
  validateAnswers,
  type TemplateDocument,
} from '@hs/forms';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { DownloadForField, readableKind } from '../../components/FieldPackage';
import { UnsyncedIndicator } from '../../components/UnsyncedIndicator';
import {
  captureEligibility,
  documentForDraft,
  findDraft,
  loadDraft,
  openDraft,
  saveAnswer,
  saveFinding,
  setCurrentItem,
  type CaptureEligibility,
  type LoadedDraft,
} from '../../offline/drafts';
import type { FindingDraftRow } from '../../offline/db';
import { capturePhoto, discardPhoto } from '../../offline/photos';
import { missingForField, storedLocations, storedTemplateVersion } from '../../offline/prefetch';
import { ItemRow } from './ItemRow';
import { countAnswered } from './presentation';

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

  /**
   * `refused` cubre spec offline-capture "Capture does not start for an inspection the
   * account is not assigned": una inspección que nunca se abrió en este dispositivo con
   * esta cuenta y cuyo `inspector_id` guardado no coincide.
   *
   * Un borrador que YA EXISTE se sigue abriendo aunque la inspección haya sido
   * reasignada mientras tanto — el que se niega a partir de acá es firmar, en
   * `ReviewRoute`, con la misma `captureEligibility` (design D5). No se niega seguir
   * editando lo que ya se empezó: negar la EDICIÓN no protege nada que negar la firma no
   * proteja ya, y le borraría al inspector el trabajo que puede seguir viendo.
   */
  const draft = useQuery({
    queryKey: queryKeys.draft(id, account?.userId),
    enabled: Boolean(account) && missing.data?.length === 0,
    queryFn: async (): Promise<
      { kind: 'loaded'; loaded: LoadedDraft } | { kind: 'refused'; reason: CaptureEligibility } | null
    > => {
      const stored = await storedTemplateVersion(id);
      if (!stored || !account) return null;

      const existing = await findDraft(id, account.userId);

      if (!existing) {
        const eligibility = captureEligibility(stored.inspector_id, account.userId);
        if (eligibility !== 'ok') return { kind: 'refused', reason: eligibility };
      }

      const row = await openDraft({
        scheduled_inspection_id: id,
        account_id: account.userId,
        site_id: stored.site_id,
        template_version_id: stored.template_version_id,
      });

      const loaded = await loadDraft(row.client_submission_id);

      return loaded ? { kind: 'loaded', loaded } : null;
    },
  });

  const loadedDraft = draft.data?.kind === 'loaded' ? draft.data.loaded : undefined;

  const document = useQuery({
    queryKey: queryKeys.document(loadedDraft?.draft.client_submission_id),
    enabled: Boolean(loadedDraft),
    queryFn: async () => (loadedDraft ? documentForDraft(loadedDraft.draft) : null),
  });

  const answer = useMutation({
    mutationFn: async (input: { itemKey: string; value: unknown; document: TemplateDocument }) => {
      if (!loadedDraft) return;

      // Se escribe ACÁ, antes de que la pantalla siguiente se pinte. Sin debounce: la
      // ventana que un debounce abre es exactamente la ventana en la que Android mata
      // el proceso.
      await saveAnswer(
        loadedDraft.draft.client_submission_id,
        input.itemKey,
        input.value,
        input.document,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) }),
  });

  const photo = useMutation({
    mutationFn: async (input: { itemKey: string; blob: Blob; kind?: 'answer' | 'finding' }) => {
      if (!loadedDraft) return;

      await capturePhoto({
        client_submission_id: loadedDraft.draft.client_submission_id,
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
      if (!loadedDraft) return;

      await saveFinding(loadedDraft.draft.client_submission_id, input.itemKey, input.patch);
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
   *
   * La descarga se ofrece acá mismo. Esta URL se alcanza por marcador o desde el shell
   * precacheado sin pasar por la lista, así que la pantalla tiene que poder resolverse
   * sola en vez de mandar a otra a hacer lo mismo.
   */
  if (missing.isSuccess && missing.data.length > 0) {
    return (
      <>
        <h1>Not ready for the field</h1>
        <p className="notice notice--warn">
          This inspection is missing {missing.data.map(readableKind).join(', ')}. Capture cannot
          start until it is downloaded, and downloading needs a connection.
        </p>
        <DownloadForField id={id} />
      </>
    );
  }

  /**
   * Spec: "Capture does not start for an inspection the account is not assigned". Se
   * resuelve enteramente con lo que ya está en el dispositivo (design D1) — sin pedir
   * nada, sin importar si hay red o no.
   */
  if (draft.data?.kind === 'refused') {
    return (
      <>
        <h1>Not your inspection</h1>
        <p className="notice notice--warn">
          {draft.data.reason === 'unassigned'
            ? 'This inspection has no inspector assigned.'
            : 'This inspection is assigned to someone else.'}
        </p>
        <p>
          <Link to="/">Back to pending inspections</Link>
        </p>
      </>
    );
  }

  if (!loadedDraft || !document.data) return <p>Loading the inspection…</p>;

  const { draft: row, answers, photos, findings } = loadedDraft;
  const readOnly = row.status === 'accepted';
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
              <ItemRow
                key={item.item_key}
                item={item}
                value={answers[item.item_key]}
                invalid={violations.some((violation) => violation.item_key === item.item_key)}
                negative={negative.has(item.item_key)}
                answerPhotos={photos.filter(
                  (photoRow) => photoRow.item_key === item.item_key && photoRow.kind === 'answer',
                )}
                findingPhotos={photos.filter(
                  (photoRow) => photoRow.item_key === item.item_key && photoRow.kind === 'finding',
                )}
                finding={findings.find((findingRow) => findingRow.item_key === item.item_key)}
                locations={locations.data ?? []}
                readOnly={readOnly}
                onFocus={() => void setCurrentItem(row.client_submission_id, item.item_key)}
                onChange={(value) =>
                  answer.mutate({ itemKey: item.item_key, value, document: document.data! })
                }
                onFindingChange={(patch) => finding.mutate({ itemKey: item.item_key, patch })}
                onCapturePhoto={(blob, kind) =>
                  photo.mutate({ itemKey: item.item_key, blob, kind })
                }
                onDiscardPhoto={(photoId) => removePhoto.mutate(photoId)}
              />
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

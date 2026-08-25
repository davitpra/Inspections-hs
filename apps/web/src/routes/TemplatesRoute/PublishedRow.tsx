import type { PublishedTemplateSummary } from '@hs/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { RowMenu, type RowAction } from '../../components/RowMenu';
import { archiveTemplate, reactivateTemplate, restoreTemplate, reviseTemplate } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';
import { formatDay } from '../../presentation/dates';
import {
  isTemplateActive,
  isTemplateArchived,
  publishedVersionLabel,
  templateStatusClass,
  templateStatusLabel,
} from './presentation';

/**
 * Una plantilla congelada: el nombre abre exactamente la versión que la fila nombra.
 *
 * RETIRAR NO ES BORRAR y la fila tiene que decirlo. Una plantilla retirada sigue acá, con
 * su versión y su fecha, porque sigue siendo la referencia de las inspecciones que se
 * hicieron con ella; lo único que cambia es que deja de ofrecerse al programar.
 *
 * "Edit template" desaparece del menú cuando está retirada, y no queda gris: el servidor
 * rechaza revisar una plantilla dada de baja (`findTemplateForRevision` filtra por
 * `deactivated_at`), así que ofrecerla sería ofrecer un error. Primero se reactiva.
 *
 * Reactivar no pregunta y retirar sí. La confirmación es para lo que cambia lo que la
 * organización puede programar mañana, no para todo lo que abre un menú.
 */
export function PublishedRow({
  template,
  canManage,
  onDeactivate,
  onArchive,
}: {
  template: PublishedTemplateSummary;
  canManage: boolean;
  /** Retirar se confirma fuera de la fila: al aplicarse, la fila se redibuja (ver `DeactivateTemplateDialog`). */
  onDeactivate: () => void;
  /** Archivar también se confirma fuera de la fila. */
  onArchive: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const active = isTemplateActive(template);
  const archived = isTemplateArchived(template);

  const revise = useMutation({
    mutationFn: () => reviseTemplate(template.id),
    onSuccess: (draft) => {
      void navigate({ to: '/templates/drafts/$id', params: { id: draft.id } });
    },
  });

  /**
   * Las dos claves, siempre. La consola cambia porque la fila cambia de estado, y
   * `templates()` cambia porque es el listado de lo programable y esta plantilla acaba de
   * entrar o de salir de él. Invalidar solo la primera dejaría a `/scheduling` ofreciendo
   * una plantilla retirada hasta el próximo refresco.
   */
  const reactivate = useMutation({
    mutationFn: () => reactivateTemplate(template.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.publishedTemplates() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templates() }),
      ]);
    },
  });

  const archive = useMutation({
    mutationFn: () => archiveTemplate(template.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.publishedTemplates() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templates() }),
      ]);
    },
  });

  const restore = useMutation({
    mutationFn: () => restoreTemplate(template.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.publishedTemplates() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templates() }),
      ]);
    },
  });

  const actions: RowAction[] = archived
    ? [
        {
          label: restore.isPending ? 'Restoring…' : 'Restore',
          disabled: restore.isPending,
          onSelect: () => restore.mutate(),
        },
      ]
    : active
    ? [
        {
          label: revise.isPending ? 'Opening…' : 'Edit template',
          disabled: revise.isPending,
          onSelect: () => revise.mutate(),
        },
      ]
    : [];

  if (canManage && !archived) {
    actions.push(
      active
        ? {
            label: 'Deactivate template',
            tone: 'danger',
            onSelect: onDeactivate,
          }
        : {
            label: reactivate.isPending ? 'Reactivating…' : 'Reactivate template',
            disabled: reactivate.isPending,
            onSelect: () => reactivate.mutate(),
          },
    );

    if (!active) {
      actions.push({
        label: archive.isPending ? 'Archiving…' : 'Archive template',
        disabled: archive.isPending,
        onSelect: onArchive,
      });
    }
  }

  const manageableActions = canManage ? actions : [];

  return (
    <tr className="published-row">
      <th scope="row" data-label="Name">
        <Link className="published-name" to="/templates/versions/$versionId" params={{ versionId: template.latest_version_id }}>
          {template.name}
        </Link>
      </th>
      <td data-label="Version" className="published-row__meta">{publishedVersionLabel(template.latest_version)}</td>
      <td data-label="Published" className="published-row__meta">{formatDay(template.latest_published_at)}</td>
      <td data-label="Status">
        <span className={templateStatusClass(template)}>{templateStatusLabel(template)}</span>
      </td>
      <td data-label="Actions" className="published-card__actions-cell">
         {canManage ? (
           <div className="table__actions">
             <RowMenu label={`More actions for ${template.name}`} actions={manageableActions} />
           </div>
         ) : null}
        {revise.isError ? (
          <p className="notice notice--warn" role="alert">
            Could not open revision.
          </p>
        ) : null}
         {reactivate.isError ? (
          <p className="notice notice--warn" role="alert">
            {reactivate.error.message}
          </p>
         ) : null}
         {restore.isError || archive.isError ? (
           <p className="notice notice--warn" role="alert">
             {(restore.error ?? archive.error)?.message}
           </p>
         ) : null}
      </td>
    </tr>
  );
}

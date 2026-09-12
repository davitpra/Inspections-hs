import { InviteDialog } from './InviteDialog';
import { DeactivateWorkerDialog } from './DeactivateWorkerDialog';
import { JhscSeatDialog } from './JhscSeatDialog';
import type { RosterDialog } from './presentation';
import { ReissueDialog } from './ReissueDialog';
import { RemoveAccessDialog } from './RemoveAccessDialog';
import { PromoteDialog } from './PromoteDialog';

/**
 * El modal que un acto de fila abrió, montado FUERA de la tabla — ver `RosterDialog`: la
 * mutación invalida el roster y la fila que lo originó vuelve con otro botón.
 *
 * Montaje condicional: cada apertura crea el modal de nuevo, así que `showModal()` corre
 * una sola vez y el email/token nacen limpios cada vez.
 *
 * `ImportDialog` no está acá: no es de una persona, y tiene su propio retorno de foco.
 */
export function RosterDialogs({
  dialog,
  siteId,
  onClose,
}: {
  dialog: RosterDialog;
  siteId: string;
  onClose: () => void;
}): React.JSX.Element {
  switch (dialog.kind) {
    case 'invite':
      return (
        <InviteDialog
          personId={dialog.personId}
          personLabel={dialog.label}
          siteId={siteId}
          onClose={onClose}
        />
      );
    case 'deactivate':
      return (
        <DeactivateWorkerDialog
          personId={dialog.personId}
          personLabel={dialog.label}
          siteId={siteId}
          onClose={onClose}
        />
      );
    case 'reissue':
      return (
        <ReissueDialog
          userId={dialog.userId}
          personLabel={dialog.label}
          siteId={siteId}
          onClose={onClose}
        />
      );
    case 'remove':
      return (
        <RemoveAccessDialog
          userId={dialog.userId}
          personLabel={dialog.label}
          canSignIn={dialog.canSignIn}
          siteId={siteId}
          onClose={onClose}
        />
      );
    case 'seat':
      return (
        <JhscSeatDialog
          userId={dialog.userId}
          personLabel={dialog.label}
          action={dialog.action}
          siteId={siteId}
          onClose={onClose}
        />
      );
    case 'promote':
      return (
        <PromoteDialog
          userId={dialog.userId}
          personLabel={dialog.label}
          siteId={siteId}
          onClose={onClose}
        />
      );
  }
}

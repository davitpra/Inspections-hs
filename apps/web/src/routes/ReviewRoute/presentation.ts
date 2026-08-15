import { FINDING_DESCRIPTION_MIN } from '@hs/contracts';

import type { IncompleteFinding } from '../../offline/drafts';

/**
 * Lo que le falta al hallazgo, en el idioma del inspector.
 *
 * "missing description" cuando ya escribió "ok" lo manda a buscar un campo que para él
 * está lleno. Nombrar el caso corto aparte es la diferencia entre volver al ítem
 * sabiendo qué hacer y volver a mirarlo sin entender.
 */
export function readableMissing(missing: IncompleteFinding['missing'][number]): string {
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

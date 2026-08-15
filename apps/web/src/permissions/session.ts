import type { Session } from '@hs/contracts';

/**
 * Qué le ofrece la interfaz a cada cuenta.
 *
 * **Esto es comodidad, no garantía, y la distinción es toda la razón del archivo.** La
 * garantía la da el servidor: `/roster` comprueba el rol en la lectura y contesta 403, y
 * el resto está detrás de RLS. Un link ausente le ahorra a alguien abrir una pantalla sin
 * controles; no impide nada. Si alguna vez esto es lo único que separa a un rol de un
 * dato, el error está del otro lado.
 *
 * **Y las dos consolas no se condicionan igual por dentro** —lo que `router.tsx` explica
 * al lado de los links y conviene no perder de vista acá:
 *
 *   - `/scheduling` sigue siendo alcanzable por URL y se renderiza de solo lectura; sus
 *     GET no comprueban rol y RLS ya recorta lo que se ve. Que un miembro del JHSC vea la
 *     programación de su planta es legítimo.
 *   - `/roster` no. Ahí el rol se comprueba también en la lectura, en el cliente y en el
 *     servidor: §4 dice que se elige a una persona sin poder ver su perfil, y un roster de
 *     solo lectura para un supervisor sería exactamente esa ficha.
 *
 * **Tres funciones y no una `isCoordinator`.** Hoy las tres preguntan lo mismo, pero son
 * tres decisiones distintas: el día que `management` pueda generar el reporte de
 * cumplimiento sin administrar el roster, colapsarlas obligaría a separarlas de nuevo y a
 * revisar cada llamada para saber cuál era cuál. El nombre de cada una dice qué se está
 * preguntando, que es lo que un `role === 'hs_coordinator'` suelto no dice.
 *
 * Van acá y no en cada ruta porque las cuatro cruzan pantallas, y aparte del componente para
 * poder probarla sin renderizar.
 *
 * Las tres son predicados de tipo y no `boolean` a secas, porque conceder implica haber
 * resuelto la cuenta: quien pregunta puede usar el `account` adentro del `if` sin volver
 * a comprobar que existe, que es lo que hacía el `account?.role !== …` que reemplazan.
 */

export function canAdministerRoster(account: Session | null): account is Session {
  return account?.role === 'hs_coordinator';
}

/**
 * Quién ve el botón de invitar en la fila del roster (proposal — "el rol de la
 * invitación desde el roster es `jhsc_member` y solo ese"). Hoy coincide con
 * `canAdministerRoster` porque los dos preguntan lo mismo con los cinco roles
 * actuales, pero es la pregunta de invitar y no la de administrar el roster: el día
 * que la consola se abra de lectura a otro rol sin darle el botón, esta es la que
 * cambia y `canAdministerRoster` no.
 */
export function canInviteFromRoster(account: Session | null): account is Session {
  return account?.role === 'hs_coordinator';
}

export function canAdministerScheduling(account: Session | null): account is Session {
  return account?.role === 'hs_coordinator';
}

export function canGenerateComplianceReport(account: Session | null): account is Session {
  return account?.role === 'hs_coordinator';
}

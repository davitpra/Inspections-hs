import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Los errores de la autoría de plantillas.
 *
 * Mismo criterio que `roster.errors.ts` y `auth.errors.ts`: el código va en el CUERPO y no
 * solo en el status, para que el cliente pueda decidir sin parsear un mensaje en inglés.
 * Acá importa más que en otros módulos, porque dos de los cuatro son `409` y la pantalla
 * tiene que decir cosas distintas ante cada uno.
 *
 * **No hay un error de "documento inválido"** y no es un olvido: un borrador incompleto no
 * es un error, es el estado normal de un documento que se está escribiendo. Lo que le falta
 * viaja como `issues` en la respuesta, no como un rechazo. Lo único que el guardado sí
 * rechaza —un `response_type` que no existe, un campo que le sobra al tipo— lo rechaza
 * `templateDraftDocumentSchema` con el `400` genérico de Zod, porque es un bug del cliente y
 * no algo que el autor pueda arreglar desde la pantalla.
 */
export type TemplateDraftErrorCode =
  | 'template_draft_forbidden'
  | 'template_draft_not_found'
  | 'template_draft_name_taken'
  | 'template_draft_name_unusable'
  | 'template_draft_site_out_of_scope';

export class TemplateDraftException extends HttpException {
  constructor(
    readonly code: TemplateDraftErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

/**
 * Escribir plantillas es del coordinador, y leer los borradores también.
 *
 * A diferencia de `/scheduling` —que deja mirar a cualquiera y solo condiciona la
 * escritura—, acá el `GET` también pasa por la comprobación. Un borrador es una plantilla a
 * medio pensar: mostrarlo sería mostrar preguntas que la organización todavía no decidió
 * hacer, y que pueden no llegar a hacerse nunca.
 *
 * La comprobación es por ROL y no por alcance de sitio, porque `template_draft` no lleva
 * `site_id` (migración 0016 §5) por la misma razón que no lo lleva `template`.
 */
export const templateDraftForbidden = (): TemplateDraftException =>
  new TemplateDraftException(
    'template_draft_forbidden',
    'Only the HS coordinator can author templates',
    HttpStatus.FORBIDDEN,
  );

/** Un borrador que no existe, o que ya fue descartado: para quien pregunta son lo mismo. */
export const templateDraftNotFound = (): TemplateDraftException =>
  new TemplateDraftException(
    'template_draft_not_found',
    'That template draft does not exist',
    HttpStatus.NOT_FOUND,
  );

/**
 * El nombre ya está tomado.
 *
 * **Habla del NOMBRE y no de la clave, aunque el índice que salta pueda ser el de la clave.**
 * Desde que la clave se deriva, el autor no la escribe y no la puede cambiar: reportarle una
 * colisión de clave sería reportarle un problema en un campo que no existe en su pantalla.
 * Lo que sí puede hacer —lo único— es elegir otro nombre.
 *
 * Un solo código para los tres casos —otro borrador vivo, una plantilla publicada, o dos
 * nombres que derivan a la misma clave— porque los tres se arreglan igual. El mensaje sí
 * distingue el tercero: "ya existe una llamada así" sobre un nombre que se ve distinto
 * dejaría al autor buscando una fila que no va a encontrar.
 */
export const templateDraftNameTaken = (name: string, nearMiss = false): TemplateDraftException =>
  new TemplateDraftException(
    'template_draft_name_taken',
    nearMiss
      ? `A template with a name very much like "${name}" already exists. Choose a different name.`
      : `A template called "${name}" already exists. Choose a different name.`,
    HttpStatus.CONFLICT,
  );

/**
 * El nombre no deja derivar ninguna clave: `"???"`, `"   "`, un nombre escrito enteramente
 * en un alfabeto que el patrón no admite.
 *
 * Es un `422` y no un `400`: el cuerpo está bien formado —`name` es un string no vacío, que
 * es todo lo que el contrato pide— y lo que falla es qué dice. Un `400` habría sugerido un
 * bug del cliente en vez de algo que el autor puede arreglar escribiendo otra cosa.
 */
export const templateDraftNameUnusable = (): TemplateDraftException =>
  new TemplateDraftException(
    'template_draft_name_unusable',
    'The name needs at least one letter or digit',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

/**
 * El alcance nombra una planta que esta cuenta no administra.
 *
 * **Es selección, no aislamiento**, y por eso este error existe en vez de un `403`. La
 * tabla no tiene `site_id` ni política RLS (0016 §5, 0020 §5): `site_ids` dice dónde se
 * PIENSA USAR la plantilla, no de quién es. Lo que el servicio se niega a hacer es
 * escribir una planta que el request no puede ver — mismo criterio que `sites.service.ts`,
 * que también filtra por `session.siteIds` sobre una tabla sin política.
 *
 * Es un `422` y no un `400` por el mismo motivo que `template_draft_name_unusable`: el
 * cuerpo está bien formado —`site_ids` es un arreglo de uuid no vacío, que es todo lo que
 * el contrato pide— y lo que falla es qué dice. Y no es un `403`, que en este módulo
 * significa otra cosa: «tu rol no escribe plantillas».
 */
export const templateDraftSiteOutOfScope = (): TemplateDraftException =>
  new TemplateDraftException(
    'template_draft_site_out_of_scope',
    'A template can only be scoped to the plants your account administers',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

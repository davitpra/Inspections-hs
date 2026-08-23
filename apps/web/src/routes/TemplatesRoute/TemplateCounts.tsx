/**
 * Las dos poblaciones de la pantalla, contadas en el encabezado.
 *
 * POR QUÉ ACÁ ARRIBA Y NO SOLO EN CADA TARJETA. El conteo ya vive en el encabezado de
 * "Your drafts" y en el de "Published templates", pero abajo: para comparar las dos hay
 * que recorrer la página entera, y en cuanto hay una docena de borradores la segunda
 * queda fuera de la pantalla. Arriba se leen juntas, que es la única lectura que el
 * coordinador hace de verdad — cuánto hay empezado contra cuánto llegó a publicarse.
 *
 * MISMA FORMA QUE LAS FICHAS DEL BUILDER (`builder__counts`): el coordinador entra acá,
 * abre un borrador y vuelve, y el mismo dato dibujado de dos formas distintas se lee como
 * dos datos distintos.
 *
 * `undefined` NO ES CERO, y por eso el tipo lo admite: mientras la consulta carga o
 * falla, "0 drafts" es una afirmación falsa sobre el trabajo de alguien. Se dibuja "—",
 * que no afirma nada; el error con su texto lo da la tarjeta de abajo.
 */
export function TemplateCounts({
  drafts,
  published,
}: {
  drafts: number | undefined;
  published: number | undefined;
}): React.JSX.Element {
  return (
    <dl className="templates__counts">
      <div>
        <dt>Drafts</dt>
        <dd>{drafts ?? '—'}</dd>
      </div>
      <div>
        <dt>Published</dt>
        <dd>{published ?? '—'}</dd>
      </div>
    </dl>
  );
}

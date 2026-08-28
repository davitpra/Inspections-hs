/**
 * La tira de datos que identifica lo que está abierto en pantalla: sitio, mes, versión,
 * quién firmó. Siempre el mismo dibujo —etiqueta chica arriba, dato abajo, detalles
 * debajo del dato— porque es siempre la misma lectura.
 *
 * Vive acá y no en una ruta porque la usan dos: la asignación destacada y el reporte de
 * una inspección enviada. Duplicar el `<dl>` haría que una de las dos derivara.
 */
export function Facts({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <dl className="facts">{children}</dl>;
}

export function Fact({
  icon,
  label,
  value,
  hints = [],
}: {
  /** El ícono de la etiqueta. Es decorativo: el nombre del dato está escrito al lado. */
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  /** Lo que acompaña al dato y no es el dato — "in 15 days", "Locked". Vacíos se caen. */
  hints?: readonly (string | null | undefined)[];
}): React.JSX.Element {
  return (
    <div className="facts__item">
      {/* Sin espacio literal entre el ícono y el nombre: la separación la da el `gap`, y
          así una etiqueta sin ícono no arranca corrida. */}
      <span className="facts__label">
        {icon}
        {label}
      </span>
      <span className="facts__value">
        {value}
        {hints
          .filter((hint): hint is string => Boolean(hint))
          .map((hint) => (
            <span key={hint} className="facts__hint">
              {hint}
            </span>
          ))}
      </span>
    </div>
  );
}

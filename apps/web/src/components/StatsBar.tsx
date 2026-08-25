/** Un número de la tira, con el ícono que lo nombra. */
export interface StatItem {
  icon: React.ReactNode;
  number: number;
  label: string;
}

/**
 * La tira de números que va antes de una lista larga: cuánto hay de cada cosa, sin contar
 * a ojo. Vive acá porque la usan dos rutas —el roster y la bandeja de salida— y lo que se
 * duplicaría es el marcado, no la decisión: cada ruta trae sus propios números.
 *
 * `tip` es la línea que explica la tira cuando los números solos no alcanzan.
 */
export function StatsBar({
  items,
  tip,
}: {
  items: readonly StatItem[];
  tip?: string;
}): React.JSX.Element {
  return (
    <div className="stats-bar">
      {items.map((item) => (
        <div className="stats-bar__item" key={item.label}>
          <span className="stats-bar__icon">{item.icon}</span>
          <span>
            <span className="stats-bar__number">{item.number}</span>
            <span className="stats-bar__label">{item.label}</span>
          </span>
        </div>
      ))}
      {tip ? <p className="stats-bar__tip">{tip}</p> : null}
    </div>
  );
}

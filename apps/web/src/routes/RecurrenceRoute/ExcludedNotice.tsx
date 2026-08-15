/**
 * Los hallazgos que quedaron fuera de toda serie por no tener `item_key` (design D8).
 *
 * **Se muestra también cuando es cero**, y esa insistencia es el punto: sin este número,
 * "nothing repeated" es indistinguible de "there was nothing to look at". §5 riesgo A
 * dice que el fallo de esta feature no produce ningún error y se ve igual que la
 * ausencia de patrón; esta línea es lo único que separa las dos lecturas en pantalla.
 */
export function ExcludedNotice({ count }: { count: number }): React.JSX.Element {
  if (count === 0) {
    return (
      <p className="notice">
        Every finding in this window came from an inspection, so all of them were checked
        against the history.
      </p>
    );
  }

  return (
    <p className="notice">
      {count} finding{count === 1 ? ' was' : 's were'} entered by hand in this window and
      cannot appear in any series: a finding reported outside an inspection has no item to
      group by.
    </p>
  );
}

/**
 * El selector de ubicación. Placeholder, igual que `PersonPicker`: sigue siendo un campo
 * de id hasta que exista la ruta que liste las ubicaciones de la planta.
 */
export function LocationPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <input
      value={value}
      placeholder="Location"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

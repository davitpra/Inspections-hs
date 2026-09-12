/**
 * El selector de Persona.
 *
 * Sigue siendo un campo de id, y ya no porque falte la pantalla de roster —`/roster`
 * existe—: lo que falta es un endpoint que liste `PersonOption` para ESTA pantalla.
 *
 * **No se conecta a `GET /people`**, que es el que alimenta la consola del roster. Ese
 * devuelve las seis columnas de `person` y solo lo puede llamar el coordinador,
 * justamente porque §4 dice que quien reporta elige a una persona **sin poder ver su
 * perfil**. Colgar este selector de ahí pondría esa superficie detrás de la pantalla de
 * una cuenta administrativa y rompería lo único que mantiene separadas a las dos.
 *
 * Lo que hace falta es una ruta con forma de `personOptionSchema` —cuatro columnas, solo
 * activas— como la que ya sirve el paquete de campo. **Lo que no cambia cuando exista es
 * qué muestra**: número de empleado y nombre, nunca un perfil.
 *
 * Vive en la carpeta de esta ruta y no en `src/components/` por lo mismo: que suba a
 * compartido es lo que lo pondría al alcance de una pantalla que no debería tenerlo.
 */
export function PersonPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <input
      value={value}
      placeholder="Employee number or name"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

import type { AnswerValue } from '@hs/contracts';
import type { TemplateItem } from '@hs/forms';

/**
 * Cómo se lee una respuesta que ya quedó registrada.
 *
 * Vive acá y no en la carpeta de una ruta porque lo dibujan DOS pantallas —el reporte
 * completo y la lectura de solo hallazgos—, y una respuesta que se llame distinto en cada
 * una sería la misma inspección contando dos historias.
 */

/**
 * La respuesta registrada, escrita para LEERSE.
 *
 * La captura dibuja controles; esto dibuja el valor que quedó. No es lo mismo y por eso no
 * se reusa `ItemRow`: un grupo de botones deshabilitado obliga a deducir la respuesta de
 * cuál se ve hundido, y un registro que se defiende ante un regulador tiene que decir lo
 * que dice de un vistazo.
 *
 * `undefined` es "no contestado" y no un caso decorativo: llega cuando el ítem estuvo
 * escondido por su condición, y `answers` no trae clave para él. Inventar un "No" ahí
 * sería afirmar que el inspector lo dejó pasar.
 */
export function answerText(item: TemplateItem, value: AnswerValue | undefined): string {
  if (value === undefined) return 'Not answered';

  switch (item.response_type) {
    case 'yes_no':
      return value === true ? 'Yes' : 'No';

    /**
     * `yes_no_na` viaja como cadena y no como booleano: "no aplica" no es "no", y
     * colapsarlos borraría la diferencia entre un extintor faltante y una sección que no
     * existe en esa planta.
     */
    case 'yes_no_na':
      return YES_NO_NA_LABELS[String(value)] ?? String(value);

    case 'single_choice':
      return optionLabel(item, String(value));

    case 'multi_choice':
      return Array.isArray(value)
        ? value.map((entry) => optionLabel(item, entry)).join(', ')
        : String(value);

    /**
     * Object keys, no imágenes. Se dice cuántas hay porque la ausencia tiene que leerse:
     * un hallazgo sin mención de sus fotos se lee como un hallazgo sin fotos, y eso es un
     * registro que declara menos evidencia de la que tiene.
     */
    case 'photo': {
      const count = Array.isArray(value) ? value.length : 0;
      return count === 1 ? '1 photo' : `${count} photos`;
    }

    case 'signature':
      return 'Signed';

    case 'scale':
    case 'number':
    case 'text':
    default:
      return String(value);
  }
}

const YES_NO_NA_LABELS: Record<string, string> = {
  yes: 'Yes',
  no: 'No',
  na: 'Not applicable',
};

/**
 * La etiqueta de la opción, no su valor crudo. El valor es la clave estable con la que se
 * guardó; la etiqueta es lo que el inspector leyó al contestar, así que es lo que tiene
 * que volver a leer.
 *
 * Cae al valor crudo cuando la opción ya no está en el documento. No debería pasar, porque
 * el documento es el congelado del envío, pero mostrar la clave es mejor que mostrar un
 * hueco donde hubo una respuesta.
 */
function optionLabel(item: TemplateItem, value: string): string {
  if (item.response_type !== 'single_choice' && item.response_type !== 'multi_choice') {
    return value;
  }

  return item.options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Cuántas respuestas quedaron registradas en una sección, dicho como se lee en pantalla.
 *
 * Se dice en plural porque una sección con una sola respuesta es común, y «1 answers»
 * delata que el número lo escribió una plantilla y no alguien que lo leyó.
 */
export function answersLabel(count: number): string {
  return count === 1 ? '1 answer' : `${count} answers`;
}

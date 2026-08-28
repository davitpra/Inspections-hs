import { sectionsInDocumentOrder } from '@hs/forms';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { getTemplateVersionPackage } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { TemplateSectionCard } from '../../components/TemplateSectionCard';
import { storedTemplateVersion } from '../../offline/prefetch';
import { ItemRow } from './ItemRow';

/**
 * Una asignación MIRADA, no capturada.
 *
 * **No escribe nada.** No abre un borrador, no descarga el paquete y no marca la
 * inspección como empezada. Esa garantía no está en un `if` de acá adentro: está en que la
 * ruta corta hacia este componente ANTES de llamar a `openDraft`, así que el código que
 * crea borradores no está en este camino (ADR-001 — un dueño, un dispositivo, y el
 * borrador es de quien lo empieza).
 *
 * Para qué existe: la próxima asignación todavía no abrió y casi nunca está descargada. El
 * inspector que quiere saber qué le van a preguntar —cuántas secciones, cuánto le va a
 * llevar— hoy no tiene dónde mirarlo sin comprometerse a bajar el paquete.
 *
 * De dónde sale el documento: del dispositivo si ya está, y si no, por red. Se pide y NO se
 * guarda, a propósito: si mirar dejara el paquete descargado, un mes futuro pasaría a estar
 * "listo para el campo" por haberlo ojeado, y la pantalla de inicio reportaría una decisión
 * que nadie tomó. Descargar sigue siendo un botón.
 */
export function Preview({ id }: { id: string }): React.JSX.Element {
  const stored = useQuery({
    queryKey: queryKeys.storedTemplateVersion(id),
    queryFn: () => storedTemplateVersion(id),
  });

  const fetched = useQuery({
    queryKey: queryKeys.templateVersionPackage(id),
    queryFn: () => getTemplateVersionPackage(id),
    // Solo cuando el dispositivo YA respondió que no lo tiene: sin esto, la vista previa de
    // una inspección descargada saldría a la red sin necesitarlo.
    enabled: stored.isSuccess && stored.data === null,
    retry: false,
  });

  const document = stored.data?.document ?? fetched.data?.document ?? null;

  /**
   * `isLoading` y no `isPending`: una consulta deshabilitada queda `pending` para siempre,
   * así que preguntarle por `isPending` dejaría la pantalla cargando eternamente en el caso
   * normal — el documento ya está en el dispositivo y la llamada por red nunca se habilita.
   */
  if (stored.isPending || fetched.isLoading) {
    return <p>Loading the preview…</p>;
  }

  if (!document) {
    return (
      <>
        <h1>Preview unavailable</h1>
        <p className="notice notice--warn">
          This inspection has not been downloaded and the template could not be retrieved.
          Previewing an assignment needs a connection.
        </p>
        <p>
          <Link className="back-link" to="/">
            Back to my inspections
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Assignment preview</h1>

      <p className="notice">
        This is a preview. Nothing here is recorded — you are not capturing this inspection,
        and no draft has been started.
      </p>

      {/*
        SIN filtrar por visibilidad, y es deliberado. `evaluateVisibility` con un conjunto de
        respuestas vacío esconde todo ítem condicional, y la vista previa quedaría
        describiendo un recorrido más corto que el real — justo la mentira equivocada para
        alguien que está decidiendo si le entra hoy.
      */}
      {/*
        La MISMA tarjeta que la captura, y sin el chip de contadas: acá no hay respuestas
        que contar. Que las dos pantallas se dibujen igual es el punto de la vista previa —
        lo que se mira ahora es exactamente lo que se va a recorrer después.
      */}
      {sectionsInDocumentOrder(document).map(([section, items], sectionIndex) => (
        <TemplateSectionCard key={section.section_key} section={section} index={sectionIndex}>
          {items.map((item, itemIndex) => (
            <ItemRow
              key={item.item_key}
              item={item}
              index={itemIndex}
              value={undefined}
              invalid={false}
              negative={false}
              answerPhotos={[]}
              findingPhotos={[]}
              finding={undefined}
              readOnly
              onFocus={() => {}}
              onChange={() => {}}
              onFindingChange={() => {}}
              onCapturePhoto={() => {}}
              onDiscardPhoto={() => {}}
            />
          ))}
        </TemplateSectionCard>
      ))}

      <p>
        <Link className="back-link" to="/">
          Back to my inspections
        </Link>
      </p>
    </>
  );
}

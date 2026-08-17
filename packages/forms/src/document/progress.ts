import { evaluateVisibility } from './visibility.js';
import { itemsInDocumentOrder, sectionsInDocumentOrder, type TemplateDocument } from './schema.js';

/**
 * Cuántos ítems VISIBLES tienen respuesta.
 *
 * El denominador implícito son los ítems visibles y no los del documento: un ítem que
 * una respuesta anterior ocultó no está sin contestar, no existe. Contarlo haría que el
 * número nunca llegara a completarse y que el inspector buscara un ítem que no está en
 * pantalla.
 */
export function countAnswered(
  document: TemplateDocument,
  answers: Record<string, unknown>,
): number {
  const visibility = evaluateVisibility(document, answers);

  return itemsInDocumentOrder(document).filter(
    (item) => visibility[item.item_key] && answers[item.item_key] !== undefined,
  ).length;
}

/** El mismo conteo, desglosado por sección — misma regla de visibilidad, una vez. */
export function countAnsweredBySection(
  document: TemplateDocument,
  answers: Record<string, unknown>,
): { section_key: string; section_title: string; answered: number; total: number }[] {
  const visibility = evaluateVisibility(document, answers);

  return sectionsInDocumentOrder(document).map(([section, items]) => {
    const visibleItems = items.filter((item) => visibility[item.item_key]);

    return {
      section_key: section.section_key,
      section_title: section.section_title,
      answered: visibleItems.filter((item) => answers[item.item_key] !== undefined).length,
      total: visibleItems.length,
    };
  });
}

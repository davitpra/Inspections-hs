import {
  evaluateVisibility,
  itemsInDocumentOrder,
  type TemplateDocument,
} from '@hs/forms';

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

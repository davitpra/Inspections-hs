import 'fake-indexeddb/auto';

/**
 * `fake-indexeddb` en vez de un navegador de verdad para la suite de unidad. Lo que se
 * prueba acá es el comportamiento del almacén —la atomicidad de una transacción, que
 * una respuesta sobreviva a recrear la base— y eso es la implementación de IndexedDB,
 * no el navegador que la hospeda. El recorrido real vive en las tareas de Chrome y de
 * Android (§9.3 y §10 de `tasks.md`).
 */

/**
 * jsdom no implementa el top layer de `<dialog>`. Para la suite alcanza con el atributo
 * `open`, que es lo que decide si el contenido se ve; el comportamiento real de modal
 * (foco atrapado, Esc, `inert` en el fondo) es del navegador y no de este componente.
 */
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Reordenar arrastrando, escrito a mano sobre Pointer Events.
 *
 * **SIN LIBRERÍA, Y ES UNA DECISIÓN DE PRESUPUESTO.** `apps/web` no tiene code-splitting:
 * todo lo que entra al bundle entra al precache del service worker, que tiene un techo
 * escrito en `scripts/check-service-worker.mjs` y comprobado en el build. Una librería de
 * drag-and-drop se la lleva puesta la inspección offline, que es la razón de ser de la
 * aplicación, para que el coordinador pueda reordenar preguntas cómodamente en su
 * escritorio.
 *
 * **POINTER Y NO HTML5 DRAG.** Los eventos `dragstart`/`drop` de HTML5 no existen en touch,
 * y la tablet es el dispositivo de ADR-010: usar drag nativo habría dejado el
 * reordenamiento muerto justo donde más incómodo es apuntar. Pointer Events son los mismos
 * para mouse, dedo y lápiz.
 *
 * **NO ES EL CAMINO DE TECLADO Y NO PRETENDE SERLO.** «Move up» y «Move down» siguen
 * existiendo en el menú de cada fila, y son los que llaman a las mismas `moveSection` /
 * `moveItem` que este hook. Arrastrar es el atajo cómodo; los botones son la garantía.
 *
 * CÓMO FUNCIONA. `onPointerDown` en la manija captura el puntero y anota de dónde salió.
 * Mientras se mueve, se busca bajo el cursor el elemento que declara `data-sortable-index`
 * y ese pasa a ser el destino: no hay medición de alturas ni cálculo de offsets, porque el
 * DOM ya sabe qué hay debajo del dedo y preguntárselo es más barato y más correcto que
 * mantener un modelo paralelo que se desincroniza con cada re-render.
 *
 * Al soltar, se llama a `onMove` con un DELTA y no con un índice absoluto, porque es lo que
 * las operaciones puras del documento ya aceptan.
 */
export interface Sortable {
  /**
   * El nombre del grupo, que cada fila repite en `data-sortable-group`. Es lo que impide
   * que arrastrar una pregunta encuentre como destino a la sección que la contiene: las dos
   * listas están anidadas y `elementsFromPoint` devuelve las dos.
   */
  group: string;
  /** Qué índice se está arrastrando, o `null`. Sirve para atenuar la fila. */
  dragging: number | null;
  /** Sobre qué índice caería ahora mismo, o `null`. */
  over: number | null;
  /**
   * ¿Esta fila es donde caería lo que se está arrastrando?
   *
   * Sin esto el arrastre no tiene ninguna devolución: se levanta una sección y no hay forma
   * de saber dónde va a quedar hasta soltarla, que es exactamente cuando ya es tarde.
   */
  isDropTarget: (index: number) => boolean;
  /** Los props de la manija de la fila `index`. */
  handleProps: (index: number) => React.HTMLAttributes<HTMLElement>;
  /** Los props del contenedor de la lista. */
  listProps: React.HTMLAttributes<HTMLElement>;
}

export function useSortable(
  /** El nombre del grupo: distingue dos listas anidadas (secciones y preguntas). */
  group: string,
  onMove: (index: number, delta: number) => void,
): Sortable {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  // En un ref además de en el estado: los handlers de puntero se disparan muchas veces por
  // segundo y leer el estado de un render viejo dejaría el destino atrasado.
  const target = useRef<number | null>(null);

  const finish = useCallback(() => {
    const from = dragging;
    const to = target.current;

    setDragging(null);
    setOver(null);
    target.current = null;

    if (from !== null && to !== null && to !== from) onMove(from, to - from);
  }, [dragging, onMove]);

  const cancel = useCallback(() => {
    setDragging(null);
    setOver(null);
    target.current = null;
  }, []);

  /**
   * Escape aborta el arrastre.
   *
   * VA EN EL DOCUMENTO Y NO EN LA MANIJA. `onPointerDown` llama a `preventDefault` —sin eso
   * el navegador arranca su propia selección de texto—, y eso impide que la manija tome el
   * foco: un `onKeyDown` sobre ella no se dispararía nunca. Mismo criterio que `RowMenu`.
   */
  useEffect(() => {
    if (dragging === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cancel, dragging]);

  const isDropTarget = useCallback(
    (index: number) => dragging !== null && dragging !== index && over === index,
    [dragging, over],
  );

  const handleProps = useCallback(
    (index: number): React.HTMLAttributes<HTMLElement> => ({
      onPointerDown: (event) => {
        // Solo el botón principal. Con el secundario se abre el menú del navegador y
        // quedaría un arrastre empezado que nadie va a terminar.
        if (event.button !== 0) return;

        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(index);
        setOver(index);
        target.current = index;
      },
      onPointerMove: (event) => {
        if (dragging === null) return;

        const under = document
          .elementsFromPoint(event.clientX, event.clientY)
          .find((element) => element.getAttribute('data-sortable-group') === group);

        const index_ = Number(under?.getAttribute('data-sortable-index'));

        if (!Number.isInteger(index_)) return;

        target.current = index_;
        setOver(index_);
      },
      onPointerUp: finish,
      // Un puntero cancelado —el sistema se lo llevó, entró una llamada— no es un soltar:
      // aplicar el movimiento ahí sería reordenar sin que nadie lo haya pedido.
      onPointerCancel: cancel,
    }),
    [cancel, dragging, finish, group],
  );

  return { group, dragging, over, isDropTarget, handleProps, listProps: { role: 'list' } };
}

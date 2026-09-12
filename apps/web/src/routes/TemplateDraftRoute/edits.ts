import {
  defaultItemConfig,
  type ChoiceOption,
  type ResponseType,
  type TemplateDraftDocument,
  type TemplateDraftItem,
  type TemplateDraftSection,
} from '@hs/contracts';

/**
 * Las operaciones del editor sobre el documento en borrador.
 *
 * **Todas son puras y ninguna muta su entrada.** El documento vive en un `useState` de
 * `index.tsx`, así que devolver el mismo objeto modificado dejaría a React sin motivo para
 * volver a dibujar y la pantalla se quedaría quieta mientras el estado ya cambió: el peor de
 * los fallos posibles acá, porque el autor sigue escribiendo sobre algo que no ve.
 *
 * **Por qué acá y no en `presentation.ts`**: esto no presenta nada. La convención del repo
 * dice que la lógica pura de una ruta va en `presentation.ts` cuando es de presentación
 * —etiquetas, clases, orden—, y el nombre tiene que decir lo que el archivo contiene.
 *
 * **Y por qué no en `packages/forms`**: `forms` es dueño de la FORMA del documento y de qué
 * lo hace publicable, y eso corre también en el servidor. Mover un ítem una posición hacia
 * arriba es del builder y de nadie más.
 *
 * EL ORDEN ES EL ARREGLO. No hay `position` que mantener: `normalizeDraft` la deriva del
 * índice al publicar. Es lo que hace que mover, insertar y eliminar sean tres operaciones de
 * arreglo sin aritmética, y que "dos ítems comparten la position" no sea un estado que este
 * archivo pueda producir.
 */

/** Mueve un elemento `delta` lugares. En los extremos devuelve el mismo arreglo. */
function move<T>(items: readonly T[], index: number, delta: number): readonly T[] {
  const target = index + delta;

  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(index, 1);

  // `splice` sobre un índice válido siempre saca un elemento; el guard es para el tipo.
  if (moved === undefined) return items;

  next.splice(target, 0, moved);

  return next;
}

/** Reemplaza la sección `index` por el resultado de `change`. */
function withSection(
  document: TemplateDraftDocument,
  index: number,
  change: (section: TemplateDraftSection) => TemplateDraftSection,
): TemplateDraftDocument {
  const section = document.sections[index];

  if (!section) return document;

  const sections = [...document.sections];
  sections[index] = change(section);

  return { sections };
}

// ---------------------------------------------------------------------------
// Secciones

/**
 * Agrega una sección al final, con una `section_key` libre.
 *
 * Nace SIN ítems, y eso la hace no publicable de entrada. Es correcto: el autor acaba de
 * decir "acá va a haber un bloque de preguntas" y todavía no dijo cuáles. `draftIssues` lo
 * reporta y la pantalla lo muestra; nada de eso impide guardar.
 */
export function addSection(
  document: TemplateDraftDocument,
  sectionKey: string,
): TemplateDraftDocument {
  return {
    sections: [
      ...document.sections,
      {
        section_key: sectionKey,
        section_title: '',
        organization_location_code: '',
        items: [],
      },
    ],
  };
}

export function renameSection(
  document: TemplateDraftDocument,
  index: number,
  title: string,
): TemplateDraftDocument {
  return withSection(document, index, (section) => ({ ...section, section_title: title }));
}

export function setSectionLocation(
  document: TemplateDraftDocument,
  index: number,
  code: string,
  nextCatalogName: string,
  currentCatalogName: string,
): TemplateDraftDocument {
  return withSection(document, index, (section) => {
    const currentTitle = section.section_title.trim();
    const catalogTitle = currentCatalogName.trim();
    const shouldSeed = currentTitle === "" || currentTitle === catalogTitle;

    return {
      ...section,
      organization_location_code: code,
      section_title: shouldSeed ? nextCatalogName : section.section_title,
    };
  });
}

/**
 * Duplica una sección con todas sus preguntas.
 *
 * **JUSTO DESPUÉS DE LA ORIGINAL, no al final.** Se duplica para escribir una variante de
 * lo que se está mirando; mandarla al final movería el trabajo lejos del lugar donde el
 * autor está trabajando, y en un documento de ocho secciones eso es scrollear para
 * encontrar lo que uno acaba de crear.
 *
 * Las identidades llegan de afuera —`newKeys` usa `crypto`, que no entra en un archivo
 * puro— y son TODAS nuevas: la sección y cada uno de sus ítems. Reutilizar una `item_key`
 * sería declarar que las dos preguntas son la misma a lo largo del tiempo, que es
 * exactamente lo que la identidad de §4 significa y lo contrario de lo que pasó acá.
 *
 * `visible_when` NO se copia, ni el de la sección ni el de sus ítems. Un duplicado que
 * responde a la misma condición que el original casi nunca es lo que se quiso, y además
 * apunta a ítems que —después de un reordenamiento— pueden dejar de estar estrictamente
 * antes, que es la única regla que esa condición tiene.
 */
export function duplicateSection(
  document: TemplateDraftDocument,
  index: number,
  keys: { section: string; items: readonly string[] },
): TemplateDraftDocument {
  const section = document.sections[index];

  if (!section) return document;

  const copy: TemplateDraftSection = {
    section_key: keys.section,
    section_title: section.section_title,
    ...(section.organization_location_code === undefined
      ? {}
      : { organization_location_code: section.organization_location_code }),
    items: section.items.map((item, itemIndex) =>
      withoutCondition({ ...item, item_key: keys.items[itemIndex] ?? item.item_key }),
    ),
  };

  const sections = [...document.sections];
  sections.splice(index + 1, 0, copy);

  return { sections };
}

export function moveSection(
  document: TemplateDraftDocument,
  index: number,
  delta: number,
): TemplateDraftDocument {
  return { sections: [...move(document.sections, index, delta)] };
}

export function removeSection(
  document: TemplateDraftDocument,
  index: number,
): TemplateDraftDocument {
  return { sections: document.sections.filter((_, each) => each !== index) };
}

// ---------------------------------------------------------------------------
// Ítems

/**
 * Agrega un ítem al final de una sección.
 *
 * Nace `yes_no` porque es el tipo de la inmensa mayoría de una inspección de seguridad —una
 * guarda está o no está— y porque es el único que deriva un hallazgo sin configurar nada.
 * Su `item_key` llega generado desde el borde de la ruta: todavía no hay pregunta.
 */
export function addItem(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemKey: string,
): TemplateDraftDocument {
  return withSection(document, sectionIndex, (section) => ({
    ...section,
    items: [
      ...section.items,
      {
        item_key: itemKey,
        prompt: '',
        required: true,
        response_type: 'yes_no',
        fails_on: 'no',
      },
    ],
  }));
}

/**
 * Un ítem sin su condición de visibilidad.
 *
 * Se escribe con `delete` sobre una copia y no con un spread selectivo porque
 * `TemplateDraftItem` es una unión discriminada de nueve formas: enumerar los campos que
 * SÍ sobreviven obligaría a nueve ramas, y la que faltara se descubriría en pantalla.
 */
function withoutCondition(item: TemplateDraftItem): TemplateDraftItem {
  const copy = { ...item };

  delete copy.visible_when;

  return copy;
}

/**
 * Duplica una pregunta, justo debajo de la original y con identidad nueva.
 *
 * Copia todo lo que la describe —el texto, el tipo de respuesta con su configuración, y si
 * es obligatoria— porque duplicar existe para escribir la variación de al lado. Lo único
 * que no viaja es `visible_when`, por lo mismo que en `duplicateSection`.
 */
export function duplicateItem(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  itemKey: string,
): TemplateDraftDocument {
  return withSection(document, sectionIndex, (section) => {
    const item = section.items[itemIndex];

    if (!item) return section;

    const items = [...section.items];
    items.splice(itemIndex + 1, 0, withoutCondition({ ...item, item_key: itemKey }));

    return { ...section, items };
  });
}

/** Reemplaza el ítem `itemIndex` por el resultado de `change`. */
function withItem(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  change: (item: TemplateDraftItem) => TemplateDraftItem,
): TemplateDraftDocument {
  return withSection(document, sectionIndex, (section) => {
    const item = section.items[itemIndex];

    if (!item) return section;

    const items = [...section.items];
    items[itemIndex] = change(item);

    return { ...section, items };
  });
}

export function setPrompt(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  prompt: string,
): TemplateDraftDocument {
  return withItem(document, sectionIndex, itemIndex, (item) => ({ ...item, prompt }));
}

export function setRequired(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  required: boolean,
): TemplateDraftDocument {
  return withItem(document, sectionIndex, itemIndex, (item) => ({ ...item, required }));
}

export function moveItem(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  delta: number,
): TemplateDraftDocument {
  return withSection(document, sectionIndex, (section) => ({
    ...section,
    items: [...move(section.items, itemIndex, delta)],
  }));
}

export function removeItem(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
): TemplateDraftDocument {
  return withSection(document, sectionIndex, (section) => ({
    ...section,
    items: section.items.filter((_, each) => each !== itemIndex),
  }));
}

/**
 * Cambia el tipo de respuesta de un ítem, REEMPLAZANDO su configuración.
 *
 * Es la operación con más filo del archivo. La configuración de cada tipo es un
 * `strictObject`, así que un `max_length` que sobreviva a un ítem que pasó a
 * `single_choice` no es un campo de más: es un documento que se va a rechazar al publicar,
 * meses después y lejos de quien lo escribió. Mezclar en vez de reemplazar sería exactamente
 * ese bug.
 *
 * Lo que SÍ sobrevive es lo que no depende del tipo: `item_key`, `prompt`, `required` y
 * `visible_when`. La pregunta sigue siendo la misma pregunta —§4 dice que solo una pregunta
 * conceptualmente nueva recibe una `item_key` nueva—; lo que cambió es cómo se contesta.
 */
export function changeResponseType(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  responseType: ResponseType,
): TemplateDraftDocument {
  return withItem(document, sectionIndex, itemIndex, (item) => {
    if (item.response_type === responseType) return item;

    const finding = item.finding
      ? responseType === 'scale' || responseType === 'number' || !item.finding.fails_when
        ? item.finding
          : {
              corrective_action: item.finding.corrective_action,
            }
      : undefined;

    return {
      item_key: item.item_key,
      prompt: item.prompt,
      required: item.required,
      ...(item.visible_when ? { visible_when: item.visible_when } : {}),
      ...(finding ? { finding } : {}),
      response_type: responseType,
      ...defaultItemConfig(responseType),
    } as TemplateDraftItem;
  });
}

/** Escribe o quita la prescripción sin tocar la configuración de la pregunta. */
export function setFinding(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  finding: NonNullable<TemplateDraftItem['finding']> | null,
): TemplateDraftDocument {
  return withItem(document, sectionIndex, itemIndex, (item) => {
    const next = { ...item };

    if (finding === null) {
      delete next.finding;
    } else {
      next.finding = finding;
    }

    return next;
  });
}

/**
 * Cambia un campo de configuración del tipo actual.
 *
 * Genérico a propósito: nueve tipos con dos o tres campos cada uno serían veinte funciones
 * casi idénticas, y la que faltara se descubriría en pantalla. El `field in item` deja el
 * ítem intacto ante un campo que su tipo no tiene, que es lo que evita que el documento
 * quede con basura de un tipo anterior.
 */
export function setConfig(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  field: string,
  value: number | string | readonly ChoiceOption[],
): TemplateDraftDocument {
  return withItem(document, sectionIndex, itemIndex, (item) =>
    field in item ? ({ ...item, [field]: value } as TemplateDraftItem) : item,
  );
}

/** Todas las `item_key` del documento, para evitar colisiones al generar una nueva. */
export function allItemKeys(document: TemplateDraftDocument): string[] {
  return document.sections.flatMap((section) => section.items.map((item) => item.item_key));
}

/**
 * `prefix`, `prefix-2`, `prefix-3`… la primera que no esté tomada.
 *
 * Existe porque dos elementos con la misma clave son un error que `draftIssues` reporta, y
 * que la pantalla lo produzca sola al agregar el segundo ítem sería reportarle al autor un
 * problema que no cometió.
 */
export function freeKey(prefix: string, taken: readonly string[]): string {
  const used = new Set(taken);

  if (!used.has(prefix)) return prefix;

  let suffix = 2;

  while (used.has(`${prefix}-${suffix}`)) suffix += 1;

  return `${prefix}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Opciones de los ítems de selección

export function addOption(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
): TemplateDraftDocument {
  return withItem(document, sectionIndex, itemIndex, (item) => {
    if (item.response_type !== 'single_choice' && item.response_type !== 'multi_choice') {
      return item;
    }

    return {
      ...item,
      options: [
        ...item.options,
        {
          value: freeKey(
            'option',
            item.options.map((option) => option.value),
          ),
          label: '',
        },
      ],
    };
  });
}

export function setOption(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  optionIndex: number,
  change: Partial<ChoiceOption>,
): TemplateDraftDocument {
  return withItem(document, sectionIndex, itemIndex, (item) => {
    if (item.response_type !== 'single_choice' && item.response_type !== 'multi_choice') {
      return item;
    }

    const options = [...item.options];
    const option = options[optionIndex];

    if (!option) return item;

    options[optionIndex] = { ...option, ...change };

    return { ...item, options };
  });
}

export function removeOption(
  document: TemplateDraftDocument,
  sectionIndex: number,
  itemIndex: number,
  optionIndex: number,
): TemplateDraftDocument {
  return withItem(document, sectionIndex, itemIndex, (item) => {
    if (item.response_type !== 'single_choice' && item.response_type !== 'multi_choice') {
      return item;
    }

    return { ...item, options: item.options.filter((_, each) => each !== optionIndex) };
  });
}

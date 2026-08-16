# ADR-012 — CSS con tokens semánticos, no Tailwind + shadcn/ui

|                             |                                                        |
| --------------------------- | ------------------------------------------------------ |
| **Estado**                  | Aceptada                                               |
| **Fecha**                   | 2026-08-16                                             |
| **Supersede**               | —                                                      |
| **Superada por**            | —                                                      |
| **Referencias**             | ADR-001, ADR-003, ADR-010; `apps/web/scripts/check-tokens.mjs`, `apps/web/scripts/check-service-worker.mjs` |
| **Changes que la consumen** | —                                                      |

## Contexto

Esta decisión ya estaba tomada y aplicada —`apps/web/src/index.css` y el check del build—
pero no estaba escrita. La tabla de stack de `docs/adr/README.md` declaraba
"Tailwind + shadcn/ui" citando ADR-003, y ADR-003 no menciona estilos ni una vez: ninguna
de las dos librerías estuvo nunca instalada. Este ADR existe para que la pregunta "¿por qué
estoy escribiendo CSS puro?" tenga respuesta en el mismo lugar que el resto de las
decisiones, en vez de reabrirse cada vez que alguien lee esa tabla.

Lo que hay hoy son 1195 líneas en un único `index.css`: dos capas de tokens —primitivas y
semánticas, el archivo explica en su encabezado por qué no hay una tercera— y 141 clases.
Los contrastes están **medidos** contra `--paper`, no estimados, con piso de 4.5:1 para
texto (WCAG 1.4.3) y 3:1 para bordes que delimitan un control o transportan estado (1.4.11).
Se lee en una planta, con luz de más y una pantalla de teléfono (ADR-010).

## Decisión

**CSS propio con dos capas de tokens. Sin Tailwind, sin shadcn/ui.**

La regla que sostiene el sistema no vive en un comentario: `scripts/check-tokens.mjs` corre
dentro de `pnpm --filter web build` y rechaza un color literal fuera del bloque de tokens,
un `var(--x)` que no resuelva, una primitiva usada salteando la capa semántica, y un color
de `index.html` o del manifest desincronizado de `--brand`.

Que sea condición del build y no convención es deliberado: ya se rompió una vez —la etapa 7
inventó su propia paleta en hex y quedaron dos sistemas conviviendo— y una regla escrita
solo en prosa se rompe de nuevo con el próximo estado nuevo.

## Por qué no Tailwind

No es por peso. Tailwind no agrega runtime JS y el JIT emite solo las utilidades usadas:
contra los 12.8 KB actuales de CSS el delta es de decenas de KB, irrelevante contra el
margen del precache.

El problema es que **`check-tokens.mjs` se queda ciego**. Escanea `.css/.ts/.tsx` buscando
literales de color y verificando que cada `var(--x)` resuelva. Una utilidad como
`bg-emerald-600` en un `.tsx` no es ninguna de las dos cosas: pasa el check y saltea la capa
semántica igual. Es exactamente la falla de la etapa 7, esta vez invisible para el guardián
que se puso para evitarla.

Es solucionable —en Tailwind v4 se borra la paleta default y `@theme` expone únicamente los
tokens semánticos, de modo que `bg-paper` sea `var(--paper)`— pero cuesta reescribir el
check para que entienda nombres de clase, y cuesta migrar 1195 líneas cuyos comentarios
documentan las decisiones de accesibilidad. El beneficio que quedaría —no tener que nombrar
clases— no paga eso.

## Por qué no shadcn/ui

Acá sí es por peso, y cae sobre la costura más restringida del proyecto.

`scripts/check-service-worker.mjs` compara el precache contra `PRECACHE_BUDGET_BYTES`, hoy
900 KiB, medido en **bytes en disco y no gzip**. La medición al momento de este ADR:

| | raw | gzip |
| --- | --- | --- |
| `index.css` | 12.8 KB | 2.9 KB |
| `index.js` | 611 KB | 181 KB |
| **precache** | **672 KB** | — |
| presupuesto | 900 KB | — |

Quedan ~228 KB. Cada componente de shadcn arrastra su primitiva de Radix, más `cva`,
`clsx` y `tailwind-merge`; un set corriente (dialog, select, dropdown, popover, tooltip,
tabs) se come buena parte de ese margen. A cambio entrega un catálogo de widgets que esta
app —formularios, tablas y badges— mayormente no usa.

El presupuesto se puede subir en un commit, y el propio script lo dice. Pero está puesto
para forzar esta conversación, y la restricción real no es el número: es la primera carga
en un Android dentro de una planta (ADR-010) y el recorrido crítico sin red (ADR-001).

## Consecuencias

- Un estado o componente nuevo busca su token semántico en `:root`; si no existe, se agrega
  ahí y no en la regla. El build lo verifica.
- El costo es escribir y nombrar las clases a mano. Se acepta: son 141 para toda la app.
- **La puerta que queda abierta** es Radix (o React Aria) **solo**, para primitivas
  puntuales con accesibilidad genuinamente difícil —combobox con navegación por teclado,
  date picker, focus trap en modal—, sin Tailwind y sin el CLI de shadcn. Se paga el
  componente que se necesita en vez de adoptar un sistema entero, y no invalida este ADR.
- Revisar esta decisión requiere responder las dos objeciones concretas: qué hace
  `check-tokens.mjs` cuando la clase no es un `var()`, y de dónde salen los bytes.

## Why

El historial cronológico mezcla tipos de inspección y obliga al inspector a distinguir a
ojo cuáles son comparables. Separar la lectura en una tabla por tipo conserva todo el
historial en una pantalla y hace visible el contexto de cada recorrido sin navegación extra.

Este change mejora la consulta operativa de períodos de requisitos-v1.2 §7, etapa 7; no
cierra una etapa nueva, sino que reorganiza una lectura ya entregada sin cambiar qué datos
se consideran completados.

## What Changes

- Reemplazar la lista global de `/historical` por una sección y una tabla por tipo de
  inspección completada por la cuenta.
- Presentar todas las secciones en `/historical`, ordenadas por nombre de tipo, y cada tabla
  en orden cronológico descendente con acceso al reporte de cada envío.
- Retirar la ruta intermedia `/historical/$templateId`; el historial completo se lee sin
  abandonar la página principal.
- Reorganizar `/findings` con una sección y una tabla por tipo, incluyendo solo las
  inspecciones completadas por la cuenta que registraron al menos un hallazgo.
- Presentar todas esas tablas directamente en `/findings`, retirar
  `/findings/types/$templateId` y conservar `/findings/$id` como la lectura de los
  hallazgos de un envío individual.
- Conservar la misma definición de completitud, el recorte por cuenta y la consulta de
  servidor que usa el historial actual.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: organiza el historial completo en tablas por tipo dentro de una sola
  lectura cronológica.
- `findings`: organiza en una sola página las inspecciones con hallazgos por tipo antes de
  abrir el detalle individual existente.

## Impact

- Frontend web: rutas históricas y de hallazgos, componentes compartidos, presentación pura,
  árbol de TanStack Router, títulos de navegación, estilos y pruebas.
- OpenSpec: requisitos de lectura de inspecciones completadas y hallazgos por tipo.
- Sin cambios de API, contratos, base de datos, RLS, service worker ni dependencias.

## Why

El historial cronológico mezcla tipos de inspección y obliga al inspector a recorrer toda
la lista para recuperar recorridos comparables. Un índice por tipo permite entrar primero
al contexto correcto y leer después su historial completo.

Este change mejora la consulta operativa de períodos de requisitos-v1.2 §7, etapa 7; no
cierra una etapa nueva, sino que reorganiza una lectura ya entregada sin cambiar qué datos
se consideran completados.

## What Changes

- Reemplazar la lista global de `/historical` por un índice con una fila por tipo de
  inspección completada por la cuenta y su cantidad de recorridos.
- Hacer navegable la celda del tipo hacia `/historical/$templateId`.
- Presentar en el detalle todo el historial completado de ese tipo, en orden cronológico
  descendente y con acceso al reporte de cada envío.
- Conservar la misma definición de completitud, el recorte por cuenta y la consulta de
  servidor que usa el historial actual.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: cambia la navegación del historial completo desde una lista global a un
  índice por tipo seguido de una lista cronológica del tipo elegido.

## Impact

- Frontend web: rutas históricas, presentación pura, árbol de TanStack Router, títulos de
  navegación, estilos y pruebas.
- OpenSpec: requisito de lectura de inspecciones completadas.
- Sin cambios de API, contratos, base de datos, RLS, service worker ni dependencias.

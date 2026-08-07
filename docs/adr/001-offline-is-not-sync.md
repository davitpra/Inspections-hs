# ADR-001 — El offline no es sincronización

|                             |                                                                          |
| --------------------------- | ------------------------------------------------------------------------ |
| **Estado**                  | Aceptada                                                                 |
| **Fecha**                   | 2026-08-06                                                               |
| **Supersede**               | —                                                                        |
| **Superada por**            | —                                                                        |
| **Referencias**             | `docs/requisitos-v1.2.md` §2, §4 (Inspección), R1, riesgo D              |
| **Changes que la consumen** | `shared-forms-engine`, `offline-inspection-capture`, `submission-ingestion-endpoint` |

## Contexto

Los no-objetivos de `docs/requisitos-v1.2.md` §2 eliminan, sin nombrarlo, todo el problema
difícil del offline:

- "Sincronización multi-dispositivo de una misma inspección" — recortado.
- "Un dueño, un dispositivo, un firmante" (§4, entidad Inspección).
- "El momento del envío es el punto de no retorno" (R1).
- Riesgo D acepta explícitamente la pérdida de borradores.

Sin concurrencia no hay conflictos. Sin conflictos no hay merge. Sin merge no hay motor
de sincronización.

## Decisión

**Descartados:** ElectricSQL, PowerSync, RxDB con replicación, WatermelonDB, Yjs, Replicache
y cualquier arquitectura basada en CRDTs. Resuelven concurrencia inexistente y cobran un
impuesto operativo permanente que un solo desarrollador no puede pagar.

**Adoptado:**

| Pieza             | Herramienta                                              | Función                                                          |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Almacén local     | Dexie (IndexedDB)                                        | Borradores, respuestas, blobs de fotos, cola de salida            |
| Service worker    | Serwist / Workbox                                        | Precache del shell, caché de plantilla y catálogos de referencia  |
| Cola de escritura | Tabla `outbox` propia                                    | Un envío, con reintentos                                          |
| Idempotencia      | `client_submission_id` (UUID generado en el dispositivo) | El servidor hace INSERT idempotente por esa clave                 |

## Caché de lectura requerido antes de salir a recorrer

El dispositivo debe tener descargado, antes de perder señal:

- La `InspecciónProgramada` asignada y su `template_version` completa (congelada).
- El catálogo cerrado de ubicaciones del sitio (pregunta resuelta 1).
- El subconjunto del roster necesario para selectores (personas activas del sitio).

## Fotos: subida separada y anterior al submit

Las fotos **no viajan dentro del payload del envío**. Se suben con presigned URLs, primero,
y el submit referencia las object keys.

Razón: si el submit falla, las fotos ya están del otro lado; si una foto falla, se reintenta
sin arriesgar el formulario. Un único payload con blobs es el diseño que hace perder
inspecciones en 48 acres.

## Consecuencias

- El servidor necesita un endpoint de presigned URL y una restricción única sobre
  `client_submission_id`.
- Reenviar el mismo `client_submission_id` debe devolver el registro existente, no un 409
  ni un duplicado.
- La cola debe sobrevivir a cierres de la app y reinicios del dispositivo.

# ADR-004 — PostgreSQL + Drizzle + Row Level Security

|                             |                                                                 |
| --------------------------- | ----------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                        |
| **Fecha**                   | 2026-08-06                                                      |
| **Supersede**               | —                                                               |
| **Superada por**            | —                                                               |
| **Referencias**             | `docs/requisitos-v1.2.md` §6 preguntas 5 y 6, riesgo A; ADR-002 |
| **Changes que la consumen** | `bootstrap-immutable-persistence`, `template-versioning-item-identity`, `site-location-catalog` (primera tabla con política RLS aplicada: `location`), `recurrence-compliance-reporting` |

## RLS para el aislamiento por sitio

La pregunta resuelta 5 ("un miembro del JHSC de St. Thomas no ve los hallazgos de Glencoe")
y la 6 ("un supervisor ve los incidentes que él mismo cargó, no los de otros") son
exactamente el caso de uso de Row Level Security.

Implementadas como políticas de Postgres, el aislamiento es una propiedad del motor. En
código de aplicación, es un `WHERE` que alguien va a olvidar en el endpoint 40.

## Drizzle, no Prisma

| Necesidad                                                    | Drizzle | Prisma       |
| ------------------------------------------------------------ | ------- | ------------ |
| SQL crudo para la consulta de recurrencia por `item_key`     | Nativo  | Escape hatch |
| Migraciones que incluyen `REVOKE`, triggers y políticas RLS  | Directo | Fricción     |
| `DISTINCT ON`, CTEs, ventanas para derivar estado            | Nativo  | Limitado     |
| Control del rol de conexión por request (necesario para RLS) | Directo | Awkward      |

El proyecto es SQL-pesado por diseño. El ORM tiene que salirse del camino.

## Esquema de respuestas: filas, no JSONB

La `template_version` publicada se almacena como documento JSONB inmutable, validado con Zod.

Las **respuestas**, en cambio, son filas:

```
response(inspection_id, template_version_item_id, item_key, value_*)
```

Razón: la consulta de detección de recurrencia (riesgo A) agrupa por `item_key` y necesita
índices. Guardar las respuestas como JSONB convierte la feature más valiosa del sistema en
un escaneo secuencial con extracción de JSON.

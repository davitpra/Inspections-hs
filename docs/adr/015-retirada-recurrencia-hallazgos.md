# ADR-015 — Retirada preproducción de la recurrencia de hallazgos

|                             |                                                                 |
| --------------------------- | --------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                        |
| **Fecha**                   | 2026-08-28                                                      |
| **Supersede**               | —                                                               |
| **Superada por**            | —                                                               |
| **Referencias**             | `docs/Requisitos_V1.2.md` §4, §5 riesgo A, §6-bis pregunta 11, §7; ADR-002, ADR-004, ADR-008, ADR-013 |
| **Changes que la consumen** | `retirar-recurrencia-de-hallazgos`                              |

## Contexto

La detección de hallazgos recurrentes se retira antes de cualquier despliegue con datos de
producción. La base de desarrollo no contiene evidencia regulatoria: las marcas existentes
describen envíos de demo, y la consulta de series no tiene ningún consumidor fuera de la
pantalla que se retira.

ADR-013 dejó a la capability `reporting` conservando únicamente `GET /findings/recurrence`.
Al retirar esa lectura, `reporting` queda sin ninguna superficie y desaparece como capability
del proyecto.

La superficie tiene dos mitades que contestan preguntas distintas y se retiran juntas:

- **La serie**, calculada al leer con un `GROUP BY` sobre `finding` y la ventana que el lector
  pidió: `GET /findings/recurrence`, el módulo `reporting` completo y la pantalla `/recurrence`.
- **La marca**, congelada al nacer el hallazgo dentro de la transacción de ingesta:
  `finding_recurrence` y el campo `recurrence` del contrato del hallazgo. Nunca se mostró en
  ninguna pantalla; su único lector era el `LEFT JOIN` del listado de hallazgos.

## Decisión

Se elimina la superficie completa: la pantalla y su navegación, el endpoint, el módulo
`reporting`, los contratos de reporte y de marca, la escritura de marcas en la ingesta y la
tabla `finding_recurrence` con su índice de apoyo.

La migración destructiva `0038` solo es válida bajo la precondición preproducción: la base
contiene datos de desarrollo y no evidencia regulatoria de producción. Fuera de esa
precondición se debe detener el despliegue y revisar la decisión antes de migrar.

La migración elimina `finding_recurrence` —y con ella sus GRANT, su política de aislamiento,
sus triggers de inmutabilidad y sus CHECK—, el índice parcial `finding_recurrence_idx` que 0010
creó para el `GROUP BY`, y el UNIQUE `finding_id_item_key_uq` que 0013 agregó sobre `finding`
como único destino de la FK compuesta de la marca. No escribe, borra ni reescribe ninguna fila
de `audit_log`.

Los eslabones históricos de `audit_log`, incluidas las lecturas registradas con
`resource: 'finding_recurrence'`, se conservan intactos aunque apunten a una tabla retirada.
Describen hechos pasados y no representan una capacidad vigente.

La eliminación de la tabla, del índice y de la constraint es DDL del rol dueño, no el borrado
de registros del dominio. ADR-002 continúa gobernando la inmutabilidad de las tablas
supervivientes, y ADR-004 continúa gobernando su aislamiento por sitio mediante RLS.

**La identidad dual sobrevive entera, y es la mitad importante de esta decisión.** `item_key`
sigue en `template_item`, `template_version_item`, `inspection_answer` y `finding`, con sus
índices, su unicidad global y su carácter write-once. La recurrencia era su consumidor más
visible, no el que la justifica: `item_key` es lo que hace que una pregunta se reconozca a
través de las versiones que la editaron, y de eso dependen la publicación, el avance de versión
y la lectura de una inspección enviada. El riesgo A de §5 sigue siendo un riesgo del esquema, y
su prueba de aceptación sigue corriendo en CI —reformulada como una agrupación por concepto que
escribe el propio test, no como una consulta de producto.

## Consecuencias

- No hay ninguna pantalla, endpoint ni contrato que agrupe hallazgos en series.
- `reporting` deja de ser una capability del proyecto; sale de `openspec/config.yaml` y su spec
  se elimina.
- Un hallazgo ya no lleva marca de recurrencia; `GET /findings` y `GET /findings/:id` dejan de
  devolver `recurrence`, y la transacción de ingesta pierde su último paso posterior a la
  derivación.
- Se conservan la identidad dual, la derivación de hallazgos, las acciones correctivas, los
  incidentes, la programación —incluidas sus reglas de recurrencia, que son otro concepto— y la
  cadena histórica de `audit_log`.
- Los payloads y las migraciones históricas pueden seguir mencionando la recurrencia; esas
  menciones no son superficie vigente y no se reescriben.
- La decisión no introduce otra métrica, serie, agregado ni tendencia para sustituirla.

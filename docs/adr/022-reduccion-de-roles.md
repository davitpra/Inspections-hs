# ADR-022 — Reducción del conjunto de roles a tres

|                             |                                                                |
| --------------------------- | -------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                       |
| **Fecha**                   | 2026-09-06                                                     |
| **Supersede**               | Parte de ADR-011                                               |
| **Superada por**            | —                                                              |
| **Referencias**             | `docs/Requisitos_V1.2.md` §4, §5 riesgo I; ADR-002, ADR-004, ADR-008, ADR-011 |
| **Changes que la consumen** | `reduce-roles-to-three`                                        |

## Contexto

El esquema y los contratos admitían cinco roles, pero `supervisor` y `external_auditor`
nunca fueron alcanzables por las pantallas, comandos ni datos de demostración. Mantenerlos
dejaba una escalada sin destinatario real y sostenía, solo para el auditor, tres columnas de
ciclo de vida, una ventana RLS sobre `audit_log` y la única excepción que registraba lecturas.

La organización necesita en cambio una segunda cuenta capaz de administrar la plataforma y
nombrar al coordinador. `management` ya era el rol con lectura completa y destinatario del
segundo escalón.

## Decisión

El conjunto cerrado queda reducido a `hs_coordinator`, `jhsc_member` y `management`.
`management` comparte las facultades administrativas de `hs_coordinator` y tiene además la
facultad exclusiva de promover una cuenta activa de `jhsc_member` a `hs_coordinator`. Crear o
avanzar una acción por la relación con su registro, la excepción del coordinador que verifica
su propio trabajo y la promoción misma siguen las excepciones declaradas en sus requisitos.

La escalada de acciones vencidas conserva dos pasos: a los tres días llega a
`hs_coordinator` y a los siete a `management`. El primer tipo de notificación pasa a ser
`corrective_action_overdue_coordinator`.

Se retira por completo el ciclo del auditor externo: `expires_at`, `records_from`,
`records_to`, su restricción, la política de ventana de registros y las funciones que la
servían. Esta decisión deja sin efecto de ADR-011 únicamente el ciclo de vida del auditor y
la excepción de registrar sus lecturas. ADR-011 continúa gobernando autenticación,
invitaciones y sesiones.

La migración destructiva solo es válida bajo la precondición preproducción: la base contiene
datos de desarrollo y no evidencia regulatoria de producción. Se niega a continuar si existe
un rol, nivel de escalada o tipo de notificación retirado. Fuera de esa precondición se debe
detener el despliegue y revisar la decisión antes de migrar.

## Consecuencias

- Una cuenta lleva exactamente uno de tres roles y `inspector` continúa siendo un campo, no un rol.
- Una cuenta `management` puede ocupar un asiento JHSC en los mismos términos que el coordinador.
- `app_user` sigue sin RLS y parcialmente mutable; su identidad congelada y la baja lógica no cambian.
- `audit_log` conserva aislamiento por sitio, inmutabilidad y todas sus entradas históricas, incluidas lecturas de auditor.
- `corrective_action_escalation` continúa inmutable y aislada por sitio. `notification` continúa parcialmente mutable solo mediante sus marcas monotónicas de lectura y retirada, además de conservar su aislamiento por sitio y la prohibición de borrado.
- No se convierte ni se elimina ninguna fila de dominio; los cambios sobre restricciones y columnas son DDL del rol dueño.

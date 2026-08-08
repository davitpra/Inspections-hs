# ADR-011 — Autenticación: better-auth dentro de apps/api

|                             |                                                     |
| --------------------------- | ----------------------------------------------------- |
| **Estado**                  | Aceptada                                            |
| **Fecha**                   | 2026-08-06                                          |
| **Origen**                  | S3 de `Stack_Tecnologico_V1.md`                     |
| **Supersede**               | —                                                   |
| **Superada por**            | —                                                   |
| **Referencias**             | `docs/requisitos-v1.2.md` §6 (Autenticación), riesgo I; ADR-001, ADR-009 |
| **Changes que la consumen** | `identity-and-roster-import`, `authentication-and-sessions` (la implementa), `offline-inspection-capture` |

## Contexto

Desbloqueada por ADR-009. Sin restricción de residencia, un IdP gestionado deja de tener
contras. Aun así, con 15–20 usuarios internos, sin SSO corporativo del lado del cliente y sin
registro público, la opción de menor superficie es **better-auth dentro de `apps/api`**, sobre
la misma Postgres.

## Decisión

- Email + contraseña, invitación por el coordinador de HS. Sin auto-registro.
- TOTP obligatorio para coordinador y gerencia; opcional para el resto.
- Sesión con `user_id`, `person_id` y `site_scope[]`, de vida corta con refresh.
- Sin cuentas compartidas entre miembros del JHSC — el `actor_id` del log de auditoría tiene
  que identificar a una persona real o la inmutabilidad no prueba nada.

## Dónde vive la identidad

`identity-and-roster-import` construyó la identidad de dominio antes que la
autenticación, y esto es lo que better-auth encuentra ya hecho:

- **`app_user`** — persona, email, rol, alcance por sitio y ciclo de vida. La tabla se
  llama así y no `user` porque `user` es palabra reservada en Postgres y porque es el
  nombre por defecto de una tabla de better-auth: dejarlo libre evita la colisión.
- **El email vive una sola vez**, en `app_user`. better-auth se configura para usar esa
  tabla como su modelo de usuario y agrega **solo** lo suyo: credencial, sesión y
  segundo factor. Una tabla propia con su propio `email` crearía dos verdades sobre la
  misma dirección, y la pregunta "¿cuál gana?" no tiene respuesta buena.
- **`app_user` no guarda ningún secreto.** Una cuenta creada hoy es una identidad
  completa que todavía no puede iniciar sesión — que es el estado correcto hasta que
  este ADR se implemente.
- **`audit_log.actor_user_id` ya referencia `app_user`**, con FK. El requisito de que el
  actor identifique a una persona real dejó de ser una intención.

Verificar la configuración de better-auth contra `app_user` es lo primero del spike de
ese change: si resultara imposible apuntarla a esta tabla, habría que mantener el email
sincronizado, y eso cambia el diseño antes de escribir sus migraciones, no después.

### Resultado del spike (better-auth 1.6.26)

**Cierra por el camino principal, sin plan B.** `app_user` no necesitó ninguna columna
nueva: better-auth declara `name`, `emailVerified`, `image` y `updatedAt` como requeridas
del modelo de usuario, pero solo rigen cuando es él quien lo inserta o actualiza, y en
este sistema nunca lo hace —las cuentas las crea el coordinador y el alta de credencial
es la aceptación de una invitación, no un `signUp`. El email sigue teniendo un solo dueño.

Dos hallazgos del spike cambiaron el diseño de `authentication-and-sessions` y se anotan
acá porque valen para cualquier uso futuro de la librería:

1. **better-auth emite `DELETE` sobre la fila de sesión al cerrar sesión y, cuando el
   motor se lo frena, responde `200 {"success":true}` igual.** Registra el error como
   interno y le dice al cliente que cerró la sesión, dejando la fila viva y el token
   sirviendo. El invariante de ADR-002 —"si el código se olvida, el motor frena y el
   error se ve"— pierde acá su segunda mitad. La barrera pasa a ser el hook
   `databaseHooks.session.delete.before`, que intercepta el borrado y escribe
   `revoked_at`; los triggers quedan como red de abajo.
2. **Su router HTTP no se monta.** Sus rutas desconocen el bloqueo por intentos, el TOTP
   obligatorio por rol, el alcance por sitio y la cadena de auditoría; montarlas al lado
   de las propias sería abrir una segunda puerta al mismo cuarto sin las cerraduras. De
   la librería se usa el contexto —hash y verificación de contraseña— y el mapeo de
   modelos.

De lo cual se sigue una corrección honesta a esta decisión: **de better-auth queda menos
de lo que este ADR suponía**. Sigue siendo la opción de menor superficie que buscaba, y
sigue evitando el IdP gestionado, pero las reglas que este sistema necesita —invitación
del coordinador, TOTP obligatorio por rol, refresh que sobrevive una semana sin señal,
auditoría encadenada por planta— no son configurables en ninguna librería de
autenticación, porque no son de autenticación: son de este dominio.

## Requisito derivado del offline

La sesión tiene que sobrevivir a un recorrido de varias horas sin red y a un envío diferido.
El token que acompaña al submit puede estar vencido al momento de sincronizar.

**Refresh silencioso al recuperar conexión, antes de vaciar el outbox, y nunca descartar una
entrada del outbox por un 401.**

## Ciclo de vida del auditor externo

Cerrado en `docs/requisitos-v1.2.md` riesgo I: cuenta creada por el coordinador, `expires_at`
obligatorio (30 días por defecto, 90 máximo), revocable, y **con las lecturas registradas en
el log de auditoría** — única excepción a no loguear lecturas en el sistema.

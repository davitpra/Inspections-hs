# ADR-026 — Despliegue en un VPS único

|                             |                                                                  |
| --------------------------- | ---------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                         |
| **Fecha**                   | 2026-09-20                                                       |
| **Supersede**               | ADR-008, sección "Topología de despliegue" (solo esa)            |
| **Superada por**            | —                                                                |
| **Referencias**             | `docs/deployment/README.md`; ADR-002, ADR-005, ADR-006, ADR-008, ADR-009, ADR-013 |
| **Changes que la consumen** | Ninguno. Es una decisión de despliegue, no de código             |

## Contexto

ADR-008 eligió cuatro piezas gestionadas —CDN estático, plataforma de contenedores,
Postgres gestionado con PITR y object storage— con el criterio explícito de "costo
operativo para un solo desarrollador". Desde entonces cambiaron dos cosas.

**ADR-013 retiró Playwright.** El criterio que ADR-008 escribe en su tabla para elegir la
plataforma de contenedores es textualmente *"Playwright necesita Chromium: sin serverless"*.
ADR-013 dice: *"Playwright y Chromium dejan de ser restricciones de runtime y hosting porque
ningún flujo superviviente genera documentos. La API sigue en un contenedor por sus otras
necesidades, pero ya no por un navegador headless."* La justificación original de esa fila
ya no está vigente. La conclusión —un contenedor de larga vida— sí lo está, pero por pg-boss
dentro del proceso (ADR-005), no por un navegador.

**La escala del despliegue quedó fijada.** Dos plantas, 15-20 cuentas, 200+ personas en el
roster, una inspección al mes por planta, un solo desarrollador, y una ventana de
mantenimiento aceptada. Cuatro proveedores gestionados son cuatro facturas, cuatro
consolas, cuatro modelos de credenciales y cuatro superficies de red que alguien tiene que
mantener con vida. A esta escala ese costo operativo pesa más que lo que compra, con una
excepción grande que esta ADR declara abajo y no disimula.

## Decisión

Una sola máquina virtual con Docker Compose: Postgres, MinIO, la API de NestJS y Caddy, con
TLS automático sobre tres subdominios. Región única, la más cercana a Ontario.

Esto supera **únicamente la sección "Topología de despliegue" de ADR-008** —su diagrama y
su tabla de cuatro piezas—. Todo el resto de ADR-008 queda intacto y sigue siendo la
referencia vigente: el monolito modular, la dirección única de las dependencias entre
módulos, la excepción declarada de `inspections` → `findings`, las dos costuras críticas y
las capas delgadas `controller → service → repository`.

| Pieza, según ADR-008 | Lo que la reemplaza |
| --- | --- |
| CDN estático (Cloudflare Pages, Netlify) | Caddy sirviendo el bundle construido, en la raíz del dominio |
| Plataforma de contenedores (Railway, Render, Fly.io) | El mismo Docker Compose de la máquina |
| Postgres gestionado **con PITR** | Un contenedor de Postgres sobre un volumen local |
| S3-compatible con versioning (R2, B2, S3) | MinIO con versioning activado, en modo path-style |

ADR-009 no se toca: sigue sin haber exigencia de residencia canadiense y sigue siendo una
sola región.

## La desviación, declarada

ADR-008, sección "El backup es la mitad de la inmutabilidad", fija tres mínimos que llama
no negociables. Esta decisión incumple dos de los tres.

1. **No hay recuperación punto-en-el-tiempo.** Un Postgres en contenedor sin archivado de
   WAL no restaura a un instante arbitrario. La ventana entre el último respaldo y la falla
   se pierde.
2. **No hay restauración de prueba antes de que el sistema tenga datos reales.** El
   despliegue va directo a producción, sin entorno de ensayo: la primera base con datos es
   la única base que va a existir. La ventana que ADR-008 pide no llega a abrirse.

El tercer mínimo sí se cumple, y sin cambios: versioning activado en el bucket y ninguna
credencial de borrado en la aplicación (ADR-006).

No se disfraza. Con esta topología, la frase de ADR-008 —*"un sistema de registro
regulatorio sin recuperación punto-en-el-tiempo tiene inmutabilidad decorativa"*— describe
un riesgo que se **asume**, no uno que se resolvió.

## Qué sustituye a lo que se pierde

Cuatro mecanismos, ninguno opcional. El **cómo** —frecuencia, destino, retención, cifrado y
comandos— es de `docs/deployment/08-backups.md`, que es su único dueño. Acá van como
obligación, no como implementación.

1. **`pg_dump` periódico fuera de la máquina.** Un volcado lógico completo, copiado a un
   destino que no comparta modo de falla con el VPS. Cambia el objetivo de recuperación de
   segundos a un período entre volcados: es peor que PITR, y es la parte que se paga.
2. **Snapshots del volumen que ofrezca el proveedor del VPS.** Cubren la pérdida de la
   máquina entera, incluidos los objetos de MinIO, que un `pg_dump` no toca.
3. **Versioning de MinIO.** Ya exigido por ADR-006: una versión de objeto no se pisa ni se
   borra desde la aplicación, porque la credencial no lleva `DeleteObject`.
4. **Un ensayo de restauración sobre una copia.** No antes de los datos reales, porque esa
   ventana no existe: se ejecuta apenas el respaldo existe, levantando una base aparte
   desde el volcado, y **nunca contra la base viva**. Es el punto exacto en el que `08`
   deja de ser un script y pasa a ser un backup. Eso de ADR-008 no se supera: un backup no
   verificado sigue sin ser un backup.

## Consecuencias

- La ventana de pérdida deja de medirse en segundos y pasa a medirse en el período entre
  volcados. Es una propiedad del sistema, no un detalle de operación, y `10-operacion.md`
  la vigila.
- La máquina es un punto único de falla. Está aceptado: sin réplicas, sin alta
  disponibilidad, con ventana de mantenimiento admitida.
- pg-boss sigue dentro del proceso y sobre la misma base (ADR-005). El contenedor no puede
  dormir: un trabajo programado que no corre no produce ningún error.
- No cambia ningún GRANT, REVOKE ni política de RLS. Los dos roles de ADR-002 son los
  mismos; lo único que cambia es quién hospeda el motor.
- El cliente deja de servirse desde un CDN y pasa a servirse desde el mismo Caddy, en la
  raíz del dominio y con fallback SPA.

## Condición de revisión

Se revisa cuando ocurra cualquiera de estas tres, y no antes:

- El ensayo de restauración de `08` falla, o el volcado deja de completarse en su ventana.
  Entonces esta topología no sostiene un registro regulatorio y hay que volver a una base
  gestionada con PITR.
- Aparece una tercera planta, o el roster pasa de cientos a miles de personas.
- Un regulador, una aseguradora o un contrato exige punto-en-el-tiempo por escrito.

Migrar es mover una base y un bucket. **No se construye nada hoy para anticiparlo.**

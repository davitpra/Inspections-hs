## Why

Hoy nada impide capturar una inspección ajena: las tres rutas del paquete de campo se
recortan por alcance de sitio, y `CaptureRoute` abre un borrador para el id que venga en
la URL sin preguntar de quién es la inspección. La asignación recién se comprueba en
`POST /inspection-submissions`, que responde `forbidden`.

Eso ya pasó en dev con datos reales: una cuenta capturó una inspección asignada a otra,
firmó, y la entrada quedó rechazada para siempre en el outbox con *"Only the inspector
this inspection is assigned to can submit it"*. El rechazo es correcto —el firmante sale
de la sesión y nunca del cuerpo— pero llega en el único momento en que ya no se puede
hacer nada: después del recorrido, después de firmar, y firmar es el punto de no retorno
(ADR-001). El aviso tiene que llegar antes de caminar la planta, no después.

Es un endurecimiento de la **etapa 3** de §7 (PWA, outbox, ingesta idempotente): cierra
el hueco entre "un dueño, un dispositivo, un firmante" y lo que el dispositivo realmente
deja hacer. No abre una etapa nueva.

## What Changes

- La lectura de `template-version` del paquete de campo agrega `inspector_id` (nullable)
  a su respuesta. Aditivo: no cambia qué inspecciones sirve ni cómo las recorta. Viaja
  por el mismo motivo que `site_id` ya viaja ahí — el dispositivo necesita saber de quién
  es la inspección **sin red**.
- El dispositivo guarda esa asignación con el resto de la descarga previa y **se niega a
  abrir un borrador nuevo** de una inspección que no es de la cuenta activa, nombrando el
  motivo en pantalla. Sin red incluida: la comprobación se resuelve contra lo descargado.
- Un borrador que **ya existe** y cuya inspección dejó de ser de la cuenta —reasignación
  a mitad de camino— queda legible: se abre y se lee. Lo que se niega es **firmar**, y la
  pantalla de revisión dice por qué. No se descarta: el trabajo del inspector no se tira
  (ADR-001).

Sin cambios de comportamiento en el servidor más allá del campo agregado: el recorte de
las tres rutas sigue siendo el alcance de sitio, el coordinador las sigue leyendo, y la
comprobación del envío se queda exactamente como está — es la que garantiza la
corrección, y esto no la reemplaza sino que evita llegar hasta ella.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: la lectura de la versión de plantilla del paquete de campo pasa a
  llevar también el `inspector_id` de la inspección. Es la requirement que enumera qué
  sirve esa lectura; el recorte por sesión no cambia.
- `offline-capture`: se agrega qué hace el dispositivo cuando la inspección no es de la
  cuenta activa — no empieza la captura, y no deja firmar un borrador que dejó de serlo.

## Impact

- `packages/contracts/src/field-package.ts` — `templateVersionPackageSchema` gana
  `inspector_id`. Es `strictObject`: agregar el campo es un cambio de contrato que las
  dos puntas tienen que compilar.
- `apps/api/src/inspections/inspections.service.ts` — `templateVersionPackage` lo lee de
  `scheduled_inspection`. Sin `WHERE site_id`: el recorte lo sigue haciendo la política
  (ADR-002).
- `apps/web/src/offline/prefetch.ts`, `db.ts` — el `PrefetchPayload` de
  `template_version` guarda el `inspector_id`. Sin migración de Dexie: es un campo
  opcional dentro de un payload que ya se guarda entero, y un dispositivo con la descarga
  vieja simplemente vuelve a descargar.
- `apps/web/src/routes/CaptureRoute.tsx`, `ReviewRoute.tsx` — donde se niega abrir y
  donde se niega firmar.
- `apps/api/test/field-package.int-spec.ts` — el campo nuevo en las aserciones. El caso
  del coordinador con las dos plantas **sigue valiendo tal cual**: esta propuesta no le
  saca la lectura a nadie.

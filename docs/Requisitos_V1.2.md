# Registro histórico v1. Los ADR vivos están en docs/adr/. No editar.

# Sistema de Inspecciones e Incidentes — Documento de Requisitos v1.2

**Estado:** consolidado. **Todas las preguntas que bloqueaban el esquema están cerradas.**
**Alcance geográfico:** dos sitios en Ontario — St. Thomas (48 acres) y Glencoe (18 acres).
**Marco regulatorio:** OHSA, JHSC certificado, WSIB, MLITSD.
**Idioma de la plataforma:** inglés únicamente.
**Documento compañero:** `Stack_Tecnologico_V1.md` (decisiones de arquitectura, ADR-001 a ADR-008).

### Cambios respecto de v1

Ninguno modifica el alcance funcional, salvo dos recortes explícitos en v1.2 (scoring y
casi-accidentes).

| Versión  | Sección                  | Cambio                                                                            |
| -------- | ------------------------ | --------------------------------------------------------------------------------- |
| v1.1     | §2 tabla de costos       | Reevaluados dos de los tres costos altos: los no-objetivos ya los habían reducido |
| v1.1     | §4 identidad del ítem    | Añadida la regla de desactivación como quinta garantía del builder                |
| v1.1     | §5 riesgo A              | Cerrado el hueco del borrado de ítems                                             |
| v1.1     | §5 riesgo D              | Pasa de accidente a decisión declarada, con mitigaciones                          |
| v1.1     | §5 riesgo G-bis          | Añadida la resolución sobre residencia de datos                                   |
| v1.1     | §6                       | Separada en preguntas cerradas y abiertas. Pregunta 2 corregida de (A) a (B)      |
| **v1.2** | §4                       | Máquina de estados del incidente. Parentesco de la acción correctiva              |
| **v1.2** | §5 riesgos C, E, F, H, I | Los cinco cerrados                                                                |
| **v1.2** | §6, §6-bis               | Preguntas 7 a 16 cerradas. Ya no quedan preguntas abiertas                        |
| **v1.2** | §7                       | Ya no hay bloqueantes de esquema. Reescrita como orden de construcción            |

**Recortes de v1.2:** el scoring ponderado sale de v1 (riesgo E) y "casi-accidente" sale de
las clasificaciones de incidente (riesgo F).

---

## 1. El problema

### Enunciado en dos frases, sin tecnología

> El equipo de salud y seguridad no logra dejar registro confiable de las inspecciones
> mensuales ni de los accidentes en dos instalaciones, porque la herramienta actual pierde
> el trabajo cuando falla la conexión y obliga a dar acceso completo al sistema a cualquiera
> que necesite cargar algo.
> Resuelto se ve así: una inspección se completa entera aunque no haya señal, una cuenta administrativa
> reporta un accidente sin poder ver información de nadie más, y cada hallazgo tiene un
> responsable con fecha hasta que alguien distinto verifica que se cerró.

### Quién lo tiene

El coordinador de Salud y Seguridad, los 7 miembros del JHSC (4 en St. Thomas, 3 en Glencoe)
y los gerentes de operaciones de ambos sitios.

### Qué hacen hoy

Usan **Atlas Citation Canada**. Dos fallas que la v1 resuelve:

1. **Pérdida de trabajo offline.** Una inspección iniciada se pierde por completo cuando
   se cae la conexión a mitad del recorrido. En 48 acres de invernadero esto no es un caso
   borde, es la norma.
2. **Permisos todo-o-nada.** Para que una persona pueda cargar un incidente hay que darle
   acceso al sistema. No existe el permiso acotado.

Una tercera falla **queda sin resolver por decisión de alcance**: Atlas no soporta español, y
la v1 tampoco lo hará — la plataforma es solo en inglés. Los usuarios hispanohablantes
sí reportan, en inglés, con la ayuda que sea necesaria. Ver riesgo G.

Consecuencia acumulada: **el roster en Atlas está desactualizado**, porque agregar personas
es manual y no hay carga masiva. Existe una lista actualizada en Excel y en ADP que el
sistema no consume.

### Por qué no se cambia de proveedor

Ya se habló con Atlas: no tienen esas capacidades. Se evaluaron alternativas: demasiado
amplias y demasiado caras para la operación.

### Cómo sabremos que funcionó

**Cerrado en v1.2.** Ventana de medición: los primeros 12 meses de uso en producción.

| Métrica                                         | Objetivo                     | Cómo se mide                                                    |
| ----------------------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| Inspecciones perdidas por conectividad          | **0** en el primer trimestre | Envíos con fallo permanente en el outbox / envíos totales       |
| Usuarios con acceso fuera de su alcance         | **0**                        | Auditoría trimestral de roles vs. sitio de operación            |
| Incidentes bloqueados por roster desactualizado | **0**                        | Reportes abandonados porque la persona no estaba en el selector |
| Tiempo de actualización del roster completo     | **≤ 15 minutos**             | Cronometrado en la importación de CSV                           |

Una sexta, sin objetivo el primer año porque no hay línea base: **mediana de días entre la
creación de un hallazgo y su cierre verificado**. Se mide desde el mes uno y se le pone
objetivo en la revisión de los 12 meses.

---

## 2. No-objetivos de la v1

### Recortado durante esta sesión

Lo siguiente estaba en el borrador inicial y **sale**:

- **Reporte de incidentes en primera persona.** Los incidentes los carga una cuenta administrativa o
  gerente. El lesionado no reporta lo suyo.
- **Formulario sin cuenta / kiosco / link público.** Todo reporte viene de un usuario
  autenticado.
- **Notas de voz** como alternativa al texto libre.
- **Iconografía para baja alfabetización.** El público del módulo pasó a ser personal
  de supervisión.
- **Multilingüe, en cualquier forma.** La plataforma es **solo en inglés**: UI, plantillas,
  formularios, notificaciones y reportes. Sin i18n, sin español, sin traducción de contenido.
  Único matiz: los campos narrativos aceptan texto en cualquier idioma y registran cuál se usó
  (dos columnas, no un módulo).
- **Traducción de plantillas de inspección.** Los 7 miembros del JHSC son anglófonos y son
  los únicos que inspeccionan.
- **Almacenamiento de detalle clínico.** El sistema **no guarda** diagnósticos, partes médicos
  ni restricciones funcionales. Solo la clasificación del incidente. Sin tabla `DetalleMédico`,
  sin control de acceso compartimentado, sin rol con permiso al detalle médico — porque no hay
  detalle que proteger. El expediente clínico vive fuera del sistema, donde vive hoy.
- **Segunda firma / representante de trabajadores como firmante adicional.** El inspector
  _es_ el miembro trabajador del JHSC. Una firma.
- **Asignación doble de la inspección** (inspector + miembro JHSC). Es la misma persona.
- **Sincronización multi-dispositivo de una misma inspección.** Un dispositivo, un dueño.

### Diferido a v2 (del alcance original)

1. Canal anónimo de reporte de peligros con código de seguimiento
2. Rotación de zonas, asignación por área, mapa de calor de cobertura
3. Códigos QR por estación
4. Traducción de plantillas de inspección
5. Capacitación y gestión de certificados
6. Gestión de SDS / WHMIS
7. Permisos de trabajo
8. Gestión de EPP
9. Integración con nómina

### Lo que NO se recortó y sigue siendo el riesgo principal

Eran cinco. Se recortaron dos (bilingüe y compartimento médico). Quedan **tres** — pero al
formalizar el stack se descubrió que **dos de las tres ya habían sido abaratadas por los
no-objetivos de esta misma sección**, sin que nadie lo notara.

| Propiedad                                | Costo asumido en v1                                         | Costo real                                           |
| ---------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Inmutabilidad + reconstrucción histórica | Event sourcing, log append-only, registros suplementarios   | Append-only forzado por Postgres. Sin CQRS ni replay |
| PWA offline-first                        | Service worker, IndexedDB, cola de sync, idempotencia       | Caché de lectura + outbox de un solo envío           |
| Builder visual de plantillas             | Tipos de respuesta, lógica condicional, versionado, scoring | **Sin cambios — sigue siendo la pieza cara**         |

**Por qué el offline se abarató.** Los recortes de esta sección — "sin sincronización
multi-dispositivo de una misma inspección", "un dueño, un dispositivo" — eliminan la
concurrencia. Sin concurrencia no hay conflictos, y sin conflictos no hace falta un motor de
sincronización. Ver ADR-001.

**Por qué la inmutabilidad se abarató.** El dominio pide log append-only, `supersedes` y
transiciones como eventos. No pide proyecciones, replay ni event store como fuente de verdad.
Postgres da lo primero con privilegios y triggers. Ver ADR-002.

**Consecuencia de presupuesto:** todo el margen de complejidad del proyecto va al builder. De
las tres, la única que sale del enunciado del problema es la PWA offline-first. La
inmutabilidad viene del requisito regulatorio. El builder es una decisión tomada a conciencia
(ver riesgo B).

---

## 3. Recorridos críticos

### R1 — Inspección mensual offline

Un miembro del JHSC recibe la inspección asignada de su sitio para el período. Abre la PWA
en el invernadero sin señal, recorre la instalación, responde el checklist en inglés, saca
fotos, y describe la ubicación de lo que encuentra. Todo se guarda incrementalmente en el
dispositivo. Firma al terminar. Cuando el dispositivo recupera conexión, la inspección se
envía y **queda congelada**. El momento del envío es el punto de no retorno.

### R2 — Del hallazgo a la acción correctiva

Una respuesta negativa en el checklist genera un hallazgo con foto y descripción obligatorias.
De ahí sale una acción correctiva con **una persona nombrada** como responsable y una fecha límite
declarada por el coordinador de HS, por management **o por quien reportó el hallazgo**
(ADR-017, ADR-025). El responsable
ejecuta la acción, o la cuenta que reportó el hallazgo puede iniciar y declarar hecho el trabajo
sin cambiar a la persona responsable (ADR-024).

### R3 — Cierre verificado de la acción

El responsable ejecuta la acción; el sistema pide y conserva evidencia antes/después, pero no
la exige para pasar a _esperando verificación_ (ADR-016). **Una persona distinta del ejecutor**
la verifica y la cierra, salvo las cuentas administrativas `coordinator` y `management`, que están
exentas cuando declaran trabajo hecho por una persona del roster sin usuario (ADR-019, ADR-025). Si
vence sin
cerrarse: +3 días escala al coordinador, +7 días a gerencia. Cada transición es un evento
append-only, no un campo que se sobrescribe.

### R4 — Reporte de incidente en tercera persona

Ocurrió un accidente (choque de montacargas, corte, caída). Un coordinador o gerente entra a
la plataforma **en inglés**, **selecciona a la persona afectada de una lista sin poder ver su
perfil**, clasifica el evento, y describe qué pasó. Registra la categoría de la lesión,
**no el diagnóstico** — eso no entra al sistema.
El sistema muestra los relojes regulatorios que aplican y notifica al coordinador de HS.
**El sistema no envía nada al MLITSD ni al WSIB.** La responsabilidad legal es de una persona.

---

## 4. Modelo de dominio

### La distinción central: Persona ≠ Usuario

Es la decisión de modelo más importante del sistema y la que resuelve el tercer dolor de Atlas.

- **Persona** — todo el personal (200+). Existe como dato, viene del roster. Puede ser sujeto
  de un incidente o responsable de una acción. **La mayoría nunca inicia sesión.**
- **Usuario** — quien tiene credenciales. Subconjunto pequeño. Referencia a una Persona.

Una cuenta administrativa selecciona una **Persona** como sujeto del incidente sin que eso implique darle
acceso al sistema a esa persona, y sin poder ver su perfil.

### Entidades

**Sitio** — St. Thomas, Glencoe. Entidad de primer nivel: atraviesa calendario, permisos,
hallazgos, incidentes y métricas. La programación se consulta por sitio.

**Persona** — identificada por número de empleado de ADP (no por nombre). Estado activo/inactivo.
Una persona inactiva **no se borra nunca** — queda referenciada en registros inmutables — pero
no aparece en el selector de sujeto de incidente.

**Usuario** — credenciales, rol, sitio(s) de alcance. Sin preferencia de idioma: la interfaz
es única.

**PlantillaDeInspección → VersiónDePlantilla → Sección → Ítem**
Una inspección apunta siempre a `template_version_id`, nunca a `template_id`.

**Identidad dual del ítem — decisión cerrada.** Un ítem tiene dos identificadores porque
resuelve dos problemas distintos:

| Identificador              | Qué es                                                      | Para qué sirve                                                                                                                     |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `template_version_item_id` | La fila concreta dentro de una versión publicada            | Fidelidad legal: qué pregunta se hizo, con esa redacción exacta, en esa sección, con ese tipo de respuesta, el día que se contestó |
| `item_key`                 | El concepto estable, asignado una sola vez al crear el ítem | Identidad: es la misma pregunta a través de las versiones publicadas que la editaron                                              |

Reglas que el builder debe garantizar:

- **Editar nunca genera `item_key` nueva.** Cambiar la redacción, mover el ítem a otra sección,
  reordenarlo o cambiarle el peso conserva la key. Solo un ítem conceptualmente nuevo recibe
  key nueva.
- `item_key` es inmutable una vez asignada. No se reutiliza, no se recicla.
- **Linaje.** Si un ítem se divide en dos ("guardas en líneas de empaque" → "guardas línea 3" +
  "guardas línea 7") o dos se fusionan en uno, ninguno de los resultantes puede heredar
  limpiamente la key original. Se requiere un campo `replaces_item_key` para dejar rastro, o
  aceptar explícitamente que la historia del concepto arranca de cero en ese punto.
- Cambiar el **tipo de respuesta** de un ítem (p. ej. sí/no → escala) conserva la key. Lo que
  identifica al ítem es el concepto que pregunta, no la forma de contestarlo. Queda registrado
  como decisión, no como accidente.
- **Los ítems se desactivan, nunca se borran.** Un ítem lleva `deactivated_at`; no existe
  `DELETE`. Un ítem desactivado desaparece de las versiones nuevas de la plantilla pero sigue
  resolviendo como referencia desde los hallazgos históricos, así que la historia del
  concepto termina en lugar de romperse. Ver pregunta cerrada 2.

**InspecciónProgramada** — sitio, período, un asignado (miembro del JHSC).

**Inspección** — estados: `borrador` (local, editable) → `enviada` (congelada) → opcionalmente
`superada` o `anulada`. Un dueño, un dispositivo, un firmante.

**Respuesta** — valor por ítem dentro de una inspección.

**Hallazgo** — origen, descripción, foto obligatoria, ubicación.
Cuando nace de un ítem de plantilla guarda **los dos identificadores**:
`template_version_item_id` para el registro legal e `item_key` para la identidad del concepto.
Un hallazgo de entrada manual no nace de una pregunta y por lo tanto **no tiene `item_key`**
— consecuencia aceptada, o hay que decidir cómo asociarlo.

**AcciónCorrectiva** — responsable (Persona nombrada), fecha límite, verificador.
Estados: `abierta` → `en progreso` → `esperando verificación` → `cerrada`.
El progreso es un **stream de eventos**, no un campo de estado.

**Parentesco — decisión cerrada en v1.2.** Una acción correctiva pertenece a **exactamente un
padre**, que es un `Hallazgo` o una `Investigación`. Se modela con dos claves foráneas
nullable y un `CHECK` que exige que haya una y solo una.

**Cardinalidad hallazgo ↔ acción: uno a muchos.** Un hallazgo puede tener varias acciones;
una acción no cubre varios hallazgos. Ver pregunta cerrada 9 para el razonamiento y para el
caso de la remediación compartida.

**Incidente** — reportante (Usuario), sujeto (Persona), sitio, clasificación
(primeros auxilios / atención médica / tiempo perdido o trabajo modificado / lesión crítica /
enfermedad ocupacional). **No existe la clasificación "casi-accidente"** — ver riesgo F.

**Estados del incidente — decisión cerrada en v1.2.** `reportado` → `en investigación` →
`cerrado`, como stream de eventos, con el mismo motor que la acción correctiva.

| Transición                       | Quién                | Guarda                                                                   |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| → `reportado`                    | Supervisor / gerente | Automática al enviar. La narrativa queda congelada                       |
| `reportado` → `en investigación` | Coordinador de HS    | Obligatoria para lesión crítica, tiempo perdido y enfermedad ocupacional |
| `en investigación` → `cerrado`   | Coordinador de HS    | Requiere causa raíz registrada **y** todas sus acciones en `cerrada`     |
| `cerrado` → `en investigación`   | Coordinador de HS    | Reapertura con motivo. Evento nuevo, no edición                          |

Un incidente de primeros auxilios o atención médica puede ir de `reportado` a `cerrado` sin
investigación, con motivo registrado. _La lista de clasificaciones que obligan investigación
debe confirmarse contra las obligaciones concretas del empleador bajo la OHSA antes de salir
a producción — el sistema la trata como configuración en código, no como regla legal
autoritativa._

**Narrativa en campos guiados — decisión cerrada.** No hay un cuadro de texto libre único.
La narrativa se descompone en campos cortos e independientes, cada uno con el idioma en que
se escribió:

| Campo                         | Tipo                                             | Por qué                                |
| ----------------------------- | ------------------------------------------------ | -------------------------------------- |
| Fecha y hora del evento       | fecha-hora                                       | No confundir con la del reporte        |
| Ubicación                     | igual criterio que en hallazgos (ver pregunta 1) | Consistencia de vocabulario            |
| Tarea que se realizaba        | texto corto                                      | La causa raíz casi siempre está acá    |
| Equipo o material involucrado | texto corto / selección                          | Habilita agrupación por equipo         |
| Qué ocurrió                   | texto corto                                      | El hecho, no la interpretación         |
| Parte del cuerpo afectada     | selección                                        | Categoría, **no diagnóstico**          |
| Tratamiento aplicado en sitio | selección                                        | Alimenta la clasificación              |
| Testigos                      | referencias a Persona                            | Reutiliza el selector sin ver perfiles |
| Acción inmediata tomada       | texto corto                                      | Lo que se hizo para contener           |

Un campo corto y concreto es mucho más fácil de completar bien para quien no escribe cómodo
en inglés que un cuadro que dice "describa el incidente". Ese es el objetivo del cambio.

**Guarda la clasificación, no el detalle clínico.** No hay campo de diagnóstico, parte médico
ni restricción funcional. Nadie —ni el coordinador de HS— puede consultar en el sistema qué
lesión tuvo una persona, solo en qué categoría cayó el evento. "Parte del cuerpo afectada" es
una categoría gruesa y es el límite: no se extiende a naturaleza de la lesión.

_La entidad `DetalleMédico` fue eliminada del alcance._

**Investigación** — causa raíz estructurada (5 porqués o árbol), testigos, secuencia de eventos.
Sus acciones correctivas usan el mismo motor que las de inspección.

**RegistroSuplementario** — `supersedes_id`, autor, motivo. El original queda visible y marcado
como superado. No es edición: es entrada adicional.

**LogDeAuditoría** — append-only: autor, timestamp de servidor, payload completo de cada evento.

### Roles y permisos

| Rol                   | Alcance                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Miembro JHSC**      | Ejecuta inspecciones de su sitio y las acciones que tiene asignadas. No administra la plataforma ni reporta incidentes en tercera persona.             |
| **Coordinador de HS** | Administra roster, cuentas, plantillas, catálogo y programación. Reporta incidentes y hallazgos manuales. Recibe el primer escalamiento de una acción. |
| **Gerencia**          | Tiene la misma autoridad administrativa que el coordinador, lectura completa y dashboards. Ejecuta las acciones que tiene asignadas, puede promover un miembro JHSC a coordinador, degradar un coordinador a miembro JHSC y recibe el escalamiento final. |

La promoción de `jhsc_member` a `hs_coordinator` y su inversa, la degradación a
`jhsc_member`, son los únicos cambios de rol expuestos y pertenecen exclusivamente a
`management`. La membresía del JHSC sigue al rol: las cuentas
activas `jhsc_member`, `hs_coordinator` y `management` pertenecen al comité.

**No existe un permiso de "no editar".** Nadie edita nada: la inmutabilidad es una propiedad
global del sistema, no un atributo de rol. Eliminar esa frase del vocabulario del proyecto.

### Nota de vocabulario

Los 7 miembros del JHSC son todos **worker reps certificados**. Las cuentas activas de los tres
roles pueden ejecutar inspecciones cuando tienen alcance vigente sobre el sitio. Por lo tanto
"inspector" nombra a la cuenta asignada y "miembro del JHSC" nombra su pertenencia derivada del rol.
**Elegir un solo término y usarlo en tablas, endpoints y UI.** Recomendación: `jhsc_member`
como rol, `inspector_id` como campo dentro de la inspección.

La elección vigente es la de ADR-024: `inspector` es el rol y `inspector_id` se muestra en
pantalla como **Assigned to**. El razonamiento original de esta nota se conserva como contexto.

---

## 5. Riesgos y decisiones abiertas

### Riesgos altos — merecen spike técnico antes de formalizar

**A. Identidad del ítem entre versiones de plantilla — resuelta por diseño, pendiente de verificar.**

Un hallazgo se registra contra la pregunta que lo encontró. Con builder visual, el coordinador
va a editar, reordenar y mover ítems. Si el hallazgo apunta solo a la fila de la versión, cada
edición parte la historia del concepto y "la misma guarda que falló en julio" deja de poder
afirmarse.

**Por qué es el riesgo más peligroso del proyecto:** no produce ningún error. Los IDs existen,
los joins funcionan y la consulta devuelve filas. Simplemente agrupa mal — y "agrupa mal" se ve
idéntico a "no hay nada que ver". Nadie duda de una lectura que no se queja.

_Mitigación:_ identidad dual (`item_key` + `template_version_item_id`) — ver sección 4.

**Prueba de aceptación obligatoria antes de la primera migración.** Tres versiones sucesivas
con ediciones realistas:

1. **v1** — crear el ítem, generar un hallazgo.
2. **v2** — cambiar la redacción, moverlo a otra sección, reordenarlo. Generar dos hallazgos.
3. **v3** — cambiar el tipo de respuesta de sí/no a escala. Generar un hallazgo.

_Aserción:_ agrupar los hallazgos por `item_key` devuelve **un grupo de 4**. Si devuelve
1 + 2 + 1, el esquema está mal y se descubrió antes de tener datos reales.

**Límite conocido:** `item_key` estable es condición necesaria pero no suficiente. Da "la misma
pregunta", no "la misma pregunta en el mismo lugar". Con 48 acres, agrupar por concepto solo
sería grueso; la pregunta cerrada 1 resuelve la mitad, porque la ubicación es una lista cerrada
y por lo tanto agrupa.

**La detección de hallazgos recurrentes se retiró antes de producción (ADR-015).** La identidad
dual sigue en pie y sigue siendo obligatoria: es lo que hace que un hallazgo resuelva la
pregunta exacta que se le hizo, y que esa pregunta se reconozca a través de las versiones que
la editaron. Lo que sale del alcance es el producto que leía esas series.

**Hueco cerrado en v1.1.** El código garantiza que editar conserva la key, pero no podía
impedir que el coordinador borrara un ítem y creara otro equivalente: key nueva, historia
partida, sin error. La decisión de **desactivar en lugar de borrar** (pregunta cerrada 2) elimina esa
tentación de raíz.

**B. El builder visual es la pieza más cara para el usuario más pequeño.**
Un solo administrador. Tipos de respuesta, lógica condicional, versionado y scoring ponderado.
Decisión tomada: **entra en v1**. Queda registrado que si el proyecto se atrasa, es por acá.

**C. Timestamp autoritativo para el cumplimiento — cerrado en v1.2.**
Una inspección llenada el 31 de octubre que sincroniza el 2 de noviembre, ¿a qué período
cuenta?

**Decisión: el timestamp de dispositivo al firmar define el período de cumplimiento. El
timestamp de servidor define el orden en el log de auditoría.** Se almacenan ambos, siempre.

Razón: al MLITSD le importa si la inspección se ejecutó dentro del período, no cuándo se
subió. Sostener lo contrario significaría que una caída de red convierte una inspección
hecha en una inspección omitida — exactamente el dolor que el sistema existe para resolver.

**Contrapeso necesario: el reloj del dispositivo no es confiable.** Al sincronizar se calcula
y almacena `clock_skew` (diferencia entre el timestamp de firma declarado y el de llegada,
menos el tiempo real transcurrido medible). Dos reglas:

- Un timestamp de firma **en el futuro** respecto del servidor se rechaza. El dispositivo pide
  corregir el reloj y reintenta.
- Un desfase mayor a **7 días** marca la inspección para revisión del coordinador. No la
  bloquea — la marca. Queda visible en el reporte de cumplimiento.

Sin esto, el período de cumplimiento sería un campo que el usuario controla libremente dentro
de un registro que se presenta como inmutable.

**D. Pérdida de borradores — mitigado en v1.1, ahora es decisión declarada.**
Los borradores viven solo en IndexedDB. En v1 esto era un accidente y no una decisión.

Dos hechos lo acotan:

- **Los dispositivos son Android.** Se elimina el desalojo de IndexedDB de Safari, que era el
  vector principal (iOS purga tras ~7 días de inactividad si la PWA no está instalada).
- **Supuesto operativo declarado:** una inspección iniciada se sincroniza dentro de los 7 días.
  Con periodicidad mensual y un recorrido de horas, es holgado.

Mitigaciones que entran a v1 como requisito, no como buena práctica:

- `navigator.storage.persist()` al arrancar la app.
- Instalación en pantalla de inicio como paso obligatorio del onboarding.
- **Indicador permanente en la UI**: "N respuestas sin enviar, borrador de hace X días."
- Advertencia visible si un borrador supera los 3 días sin sincronizar.

Sigue siendo cierto que un teléfono perdido se lleva una inspección. Eso ahora es coherente
con "el submit es el punto de no retorno" y está aceptado explícitamente.

**E. Scoring ponderado sin destino — cerrado en v1.2: sale de v1.**
Estaba en el builder pero no aparecía en ninguna métrica ni pantalla del documento. No tiene
consumidor, así que no entra.

Es además el recorte más barato disponible para descargar el riesgo B: el builder es la pieza
más cara del proyecto y el scoring es su parte menos justificada.

**Se preserva la opción sin construirla:** el ítem conserva la columna `weight` (nullable), que
no se expone en la UI del builder ni se usa en ningún cálculo. Añadir scoring en v2 no
requerirá migrar versiones de plantilla ya publicadas.

_No exponer el campo es parte de la decisión._ Un peso configurable que no hace nada es peor
que ningún peso: el coordinador lo ajusta esperando efecto.

### Riesgos medios

**F. La métrica de casi-accidentes queda vacía — cerrado en v1.2: se saca.**
Con reporte en tercera persona por personal de supervisión, nadie va a cargar un formulario
por un evento donde no pasó nada. El indicador iba a ser cercano a cero y no iba a significar
lo que dice la nota interpretativa: "no hay casi-accidentes" y "no hay reporte de
casi-accidentes" se ven idénticos en un dashboard.

**Decisión: "casi-accidente" sale de las clasificaciones de incidente, y el indicador de
volumen sale de la analítica.** Este módulo mide cumplimiento, no prevención.

**Pero el evento sigue teniendo dónde vivir.** Un gerente que presencia un casi-accidente
lo carga como **hallazgo de entrada manual**, que ya existe en §4: descripción, foto,
ubicación, y de ahí sale una acción correctiva con responsable y
fecha. Es el camino correcto — la prevención vive en el módulo de hallazgos, que es donde
tiene consecuencias.

_Consecuencia aceptada:_ los hallazgos manuales no tienen `item_key` y quedan fuera de
cualquier agrupación por concepto (§4). Los casi-accidentes heredan ese punto ciego. Se revisa
en v2 si el volumen lo justifica.

**G. Fidelidad del relato con la plataforma solo en inglés.**
Un usuario hispanohablante presencia el accidente y tiene que describirlo en inglés, en un
registro inmutable que puede terminar en un Form 7 del WSIB o en un expediente del MLITSD.
El riesgo no es de código: es que la narrativa quede pobre, ambigua o incompleta justo en el
documento donde la precisión importa más. Mitigaciones posibles sin construir i18n:

- Los campos narrativos aceptan texto en cualquier idioma y registran cuál se usó. Si el
  usuario escribe en español, el registro conserva sus palabras exactas.
- Campos guiados y estructurados (qué, dónde, cuándo, quién, qué tarea se hacía) en lugar de
  un solo cuadro de texto libre grande. Reducen la carga de redacción.
- **No usar traducción automática** dentro de un registro inmutable.

_Nota:_ si en producción se observa que los usuarios hispanohablantes dejan de reportar o
reportan de segunda mano, esta decisión de alcance hay que revisarla.

**G-bis. La confidencialidad médica no desaparece con la tabla.**
PIPEDA probablemente nunca aplicó: cubre datos de empleados en empleadores de jurisdicción
federal, y un invernadero en Ontario es de jurisdicción provincial. Pero la OHSA restringe la
divulgación de información médica de un trabajador sin su consentimiento. La estrategia adoptada
—**no almacenar detalle clínico en absoluto**— es la forma limpia de cumplir sin construir
compartimentos. Requiere disciplina operativa: si alguien empieza a pegar diagnósticos en el
campo narrativo, el problema regresa por la puerta de atrás y sin control de acceso.

**Residencia de datos — resuelta en v1.1.** El cliente confirmó que **no exige alojamiento en
territorio canadiense**. Es consistente con lo anterior: sin detalle clínico en el sistema, la
sensibilidad del dato almacenado es baja. El hosting se elige por costo operativo (ver ADR-008).
Si un contrato futuro lo exigiera, el impacto es mover un contenedor y una base de datos — no
se construye nada hoy para anticiparlo.

**H. Alcance de "precarga el Form 7" — cerrado en v1.2: pantalla, no PDF.**
Podía significar mostrar los campos en pantalla o generar el PDF oficial del WSIB. Dos
semanas de diferencia.

**Decisión: pantalla de solo lectura con los valores del incidente mapeados a los campos del
Form 7, con copiar-al-portapapeles por campo y copiar-todo.** No se genera el PDF oficial.

Tres razones:

1. El sistema **no envía nada al WSIB** (R4). La responsabilidad legal es de una persona, que
   de todas formas va a entrar al portal del WSIB.
2. Generar el formulario oficial crea una obligación de mantenimiento permanente sobre un
   formato que no controlamos, y un riesgo de que el sistema produzca un documento
   desactualizado con apariencia de oficial.
3. Dos semanas de un solo desarrollador rinden mucho más en el builder (riesgo B).

Se revisa en v2 si el coordinador reporta que la transcripción es un dolor real.

**I. Ciclo de vida del auditor externo — retirado por ADR-022.**

El rol `external_auditor`, su vencimiento, su ventana de registros y la excepción que
registraba sus lecturas se retiraron antes de producción. Una auditoría externa se atiende
con una cuenta administrativa dentro de su alcance de sitio, sin un ciclo de vida especial.

_(La pregunta sobre el detalle médico ya no aplica: no hay detalle médico en el sistema.)_

---

## 6. Preguntas cerradas

> **Nota de v1.1.** En v1 esta sección se titulaba "Preguntas resueltas" y contenía tanto
> decisiones tomadas como preguntas sin responder. Se separó en §6 (cerradas en el
> descubrimiento) y §6-bis (cerradas en v1.2). En v1.2 ya no quedan preguntas abiertas.

### Modelo de datos

1. **¿La ubicación del hallazgo es texto libre o lista cerrada por sitio?**
   Con 48 acres, "falta guarda en línea de empaque" cuatro meses seguidos puede ser la misma
   línea o cuatro distintas. Texto libre mata la agrupación fina.
   **→ Lista cerrada administrada por el coordinador** — un desplegable, sin QR ni GPS.

2. **¿El builder puede borrar un ítem o solo desactivarlo?**
   Es dependencia directa de la decisión de identidad dual. El código puede garantizar que
   editar conserva la `item_key`, pero no puede impedir que el coordinador borre un ítem y
   cree otro que significa lo mismo — key nueva, historia partida, y el sistema no se queja.
   **→ Solo desactivar. Nunca borrar.** _(Corregido en v1.1: v1 decía borrado real, que es
   incompatible con la inmutabilidad global de §4 — rompía el enlace
   `template_version_item_id` de los hallazgos históricos, justo la fidelidad legal que la
   identidad dual existe para proteger.)_
   Implicación de esquema: el ítem lleva `deactivated_at`, no hay `DELETE`, y la historia del
   concepto termina en lugar de romperse.

3. **¿El roster es importación por archivo o sincronización con ADP?**
   Existe la lista en Excel y en ADP. Se pidió carga masiva.
   **→ Importación de CSV/Excel cuando cambia algo** — manual, controlado, alguien tiene que
   acordarse.

4. ~~**¿El texto en español de un incidente se traduce?**~~ La plataforma es solo en inglés y
   no hay traducción de ningún tipo. La narrativa se captura en **campos guiados**, no en un
   cuadro de texto libre único — ver §4 para el set de campos.

### Permisos

5. **¿Un miembro del JHSC de St. Thomas ve los hallazgos de Glencoe?**
   Cada lugar de trabajo tiene su JHSC y su obligación propia.
   **→ No. Solo coordinador y gerencia ven ambos sitios.**

6. **¿Un miembro del JHSC ve incidentes de otras personas?**
   **→ No. RLS solo admitiría aquellos cuyo `reported_by` lo nombre; como no puede reportar en
   tercera persona, en el flujo ordinario no ve ninguno.**

### Cerradas en v1.1 (fuera del alcance original de esta sección)

| Tema                | Decisión                                                              |
| ------------------- | --------------------------------------------------------------------- |
| Residencia de datos | Sin exigencia de territorio canadiense. Ver riesgo G-bis              |
| Dispositivos        | Android. Sincronización dentro de los 7 días. Ver riesgo D            |
| Autenticación       | Cuentas por invitación, email y contraseña. Sin segundo factor en el MVP (ADR-011, nota de alcance). Ver ADR-008 |

---

## 6-bis. Preguntas cerradas en v1.2

Todas cerradas siguiendo las recomendaciones ya registradas en §5. El razonamiento completo
de cada una vive en el riesgo correspondiente; acá queda la decisión.

### Módulo de incidentes

7. **¿El incidente tiene estados propios?**
   **→ Sí: `reportado` → `en investigación` → `cerrado`.** Como stream de eventos, con el
   mismo motor que la acción correctiva. Tabla de transiciones y guardas en §4.
   La decisión clave no es la lista de estados sino la **guarda de cierre**: un incidente no
   puede cerrarse con acciones correctivas abiertas. Eso hace que el estado del incidente sea
   una consecuencia del trabajo real y no una declaración administrativa.

8. **¿Se saca "casi-accidente" de las clasificaciones?**
   **→ Sí, sale.** Y el evento se carga como hallazgo manual, que es donde tiene
   consecuencias. Razonamiento completo en riesgo F.

9. **¿Un hallazgo puede tener varias acciones correctivas, y una acción cubrir varios hallazgos?**
   **→ Uno a muchos. Un hallazgo, varias acciones. Una acción, un solo hallazgo.**

   Con muchos-a-muchos hay que inventar una regla para coordinar una sola acción entre varios
   hallazgos, y una sola verificación cerraría silenciosamente siete hallazgos. R3 pide lo
   contrario: cada hallazgo necesita su propio cierre verificado por alguien distinto del
   ejecutor.

   **El caso de la remediación compartida.** "Instalar guardas en las 7 líneas de empaque"
   cubre siete hallazgos. Se crean siete acciones, cada una con la fecha límite declarada para
   ese trabajo, y comparten un `remediation_group_id` **opcional y sin semántica** — sirve para
   agrupar en la UI y en reportes, no altera plazos, escalamientos ni verificación.
   El costo es cargar la evidencia siete veces. Se acepta: la alternativa es ambigüedad en un
   registro que puede terminar ante el MLITSD.

   La acción correctiva tiene un solo padre, que es un `Hallazgo` o una `Investigación`. Ver §4.

10. **¿El formulario de incidentes se versiona? ¿Es configurable?**
    **→ Esquema fijo en código, versionado explícito, no configurable en v1.**
    - Los nueve campos guiados de §4 viven en código, no en la base de datos.
    - `Incidente` almacena `incident_form_version` (entero). Agregar un campo es una versión
      nueva más una migración, no un cambio de configuración.
    - Existe en código un registro `versión → conjunto de campos`, para que el reporte y la
      pantalla del Form 7 puedan renderizar un incidente viejo con los campos que existían
      entonces. Sin eso, "vacío porque no aplicaba" y "vacío porque no existía" se vuelven
      indistinguibles, y en un registro inmutable eso no se corrige después.
    - El builder visual **no gana un segundo consumidor**. Sigue siendo solo de plantillas de
      inspección. Los plazos legales que dependen de estos campos no se dejan en manos de un
      constructor visual.

### Analítica y cumplimiento

11. **¿La clave de recurrencia es `item_key` sola o `item_key` + ubicación?**
    **→ Sin efecto: la detección de hallazgos recurrentes salió de v1 (ADR-015).** La respuesta
    original se conserva abajo porque explica por qué la ubicación es una lista cerrada y por
    qué `item_key` es global, dos decisiones que siguen vigentes.

    ~~Las dos, como consultas distintas. `item_key` + `location_id` es la vista por defecto.~~

    No es indecisión: significan cosas diferentes y ambas importan.

    | Agrupación                 | Qué responde                                | Acción que dispara |
    | -------------------------- | ------------------------------------------- | ------------------ |
    | `item_key` + `location_id` | "La guarda de la línea 3 falta desde julio" | Arreglar esa línea |
    | `item_key` solo            | "Faltan guardas en todo el sitio"           | Problema sistémico |

    Con la ubicación ya como lista cerrada (pregunta 1), ambas agrupan bien. Es un índice sobre
    `(item_key, location_id, occurred_at)` y un `GROUP BY` adicional — no es alcance nuevo.

    El punto ciego se mantiene: los hallazgos manuales no tienen `item_key` y quedan fuera de
    cualquier agrupación por concepto.

12. **¿Cuál timestamp manda para el período de cumplimiento?**
    **→ El de dispositivo al firmar, con validación de desfase.** Ver riesgo C.

13. **¿Quién consume el scoring ponderado?**
    **→ Nadie, y por eso sale de v1.** Ver riesgo E.

14. **¿"Precarga el Form 7" es mostrar campos o generar el PDF del WSIB?**
    **→ Mostrar campos, con copiar-al-portapapeles. Sin PDF oficial.** Ver riesgo H.

15. ~~**¿Cuál es el ciclo de vida del auditor externo?**~~
    **→ Pregunta retirada por ADR-022 junto con el rol `external_auditor`.** Ver riesgo I.

16. **¿Cuáles son los números de "cómo sabremos que funcionó"?**
    **→ Cinco métricas con objetivo y una sexta sin línea base.** Ver §1.

---

## 7. Orden de construcción

**No quedan preguntas que bloqueen el esquema.** Se puede escribir completo.

El orden que sigue no es arbitrario: cada etapa deja verificable la propiedad más riesgosa
del proyecto antes de que la siguiente dependa de ella.

| Etapa | Qué se construye                                                               | Qué queda probado                                 |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| 0     | Monorepo, CI, Postgres con roles y `REVOKE`, RLS por sitio                     | **Spike 2:** el `UPDATE` falla en el motor        |
| 1     | Plantilla, versión, sección, ítem con identidad dual, publicación congelada    | **Spike 3:** v1→v2→v3 devuelve un grupo de 4      |
| 2     | Sitio, Persona, Usuario, auth, importación CSV del roster                      | Permisos por sitio verificados con datos reales   |
| 3     | Motor de formularios en `packages/forms`, PWA, outbox, ingesta idempotente     | **Spike 1:** inspección completa sin señal        |
| 4     | Hallazgos                                                                      | R1 y R2 completos; clasificación de riesgo retirada antes de producción |
| 5     | Acciones correctivas, eventos, escalamientos con pg-boss                       | R3 completo, con evidencia de cierre opcional (ADR-016) y el coordinador exento del verificador distinto (ADR-019) |
| 6     | Incidentes, campos guiados, estados, relojes regulatorios, pantalla del Form 7 | R4 completo                                       |
| 7     | Consulta operativa de períodos                                             | R5 y la recurrencia de hallazgos retirados antes de producción |
| 8     | Builder visual                                                                 | El coordinador deja de depender del desarrollador |

**El builder va último a propósito.** Es la pieza más cara (riesgo B) y el sistema es
utilizable sin él: las primeras plantillas se cargan como seeds en SQL. Si el proyecto se
atrasa, se atrasa en la etapa 8 y no en el recorrido crítico. Esa es la única secuencia que
convierte el riesgo B en algo que se puede absorber en lugar de sufrir.

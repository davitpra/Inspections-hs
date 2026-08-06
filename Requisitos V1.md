# Sistema de Inspecciones e Incidentes — Documento de Requisitos v1

**Estado:** consolidado tras sesión de descubrimiento. Contiene decisiones cerradas y
decisiones abiertas explícitamente marcadas.
**Alcance geográfico:** dos sitios en Ontario — St. Thomas (48 acres) y Glencoe (18 acres).
**Marco regulatorio:** OHSA, JHSC certificado, WSIB, MLITSD.
**Idioma de la plataforma:** inglés únicamente.

---

## 1. El problema

### Enunciado en dos frases, sin tecnología

> El equipo de salud y seguridad no logra dejar registro confiable de las inspecciones
> mensuales ni de los accidentes en dos instalaciones, porque la herramienta actual pierde
> el trabajo cuando falla la conexión y obliga a dar acceso completo al sistema a cualquiera
> que necesite cargar algo.
> Resuelto se ve así: una inspección se completa entera aunque no haya señal, un supervisor
> reporta un accidente sin poder ver información de nadie más, y cada hallazgo tiene un
> responsable con fecha hasta que alguien distinto verifica que se cerró.

### Quién lo tiene

El coordinador de Salud y Seguridad, los 7 miembros del JHSC (4 en St. Thomas, 3 en Glencoe),
y los supervisores y gerentes de operaciones de ambos sitios.

### Qué hacen hoy

Usan **Atlas Citation Canada**. Dos fallas que la v1 resuelve:

1. **Pérdida de trabajo offline.** Una inspección iniciada se pierde por completo cuando
   se cae la conexión a mitad del recorrido. En 48 acres de invernadero esto no es un caso
   borde, es la norma.
2. **Permisos todo-o-nada.** Para que una persona pueda cargar un incidente hay que darle
   acceso al sistema. No existe el permiso acotado.

Una tercera falla **queda sin resolver por decisión de alcance**: Atlas no soporta español, y
la v1 tampoco lo hará — la plataforma es solo en inglés. Los supervisores hispanohablantes
sí reportan, en inglés, con la ayuda que sea necesaria. Ver riesgo G.

Consecuencia acumulada: **el roster en Atlas está desactualizado**, porque agregar personas
es manual y no hay carga masiva. Existe una lista actualizada en Excel y en ADP que el
sistema no consume.

### Por qué no se cambia de proveedor

Ya se habló con Atlas: no tienen esas capacidades. Se evaluaron alternativas: demasiado
amplias y demasiado caras para la operación.

### Cómo sabremos que funcionó

_Pendiente de definir con números._ Candidatos derivados de los dolores que sí se atacan:

- Ninguna inspección perdida por conectividad en el primer trimestre de uso.
- Ningún usuario con más acceso del que su rol necesita.
- El roster refleja la plantilla real sin carga manual persona por persona.
- 12 de 12 períodos con inspección completada por sitio en el año.

---

## 2. No-objetivos de la v1

### Recortado durante esta sesión

Lo siguiente estaba en el borrador inicial y **sale**:

- **Reporte de incidentes en primera persona.** Los incidentes los carga el supervisor o
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

Eran cinco. Se recortaron dos (bilingüe y compartimento médico). Quedan **tres**, cada una con
costo de proyecto propio, con un solo desarrollador:

| Propiedad                                | Por qué es cara                                             |
| ---------------------------------------- | ----------------------------------------------------------- |
| Inmutabilidad + reconstrucción histórica | Event sourcing, log append-only, registros suplementarios   |
| PWA offline-first                        | Service worker, IndexedDB, cola de sync, idempotencia       |
| Builder visual de plantillas             | Tipos de respuesta, lógica condicional, versionado, scoring |

De las tres, la única que sale del enunciado del problema es la PWA offline-first. La
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
El coordinador de HS lo clasifica por matriz de probabilidad × severidad y registra el nivel
de la jerarquía de controles de la solución propuesta. De ahí sale una acción correctiva con
**una persona nombrada** como responsable y una fecha límite derivada de la severidad.

### R3 — Cierre verificado de la acción

El responsable ejecuta la acción y carga evidencia antes/después. La acción pasa a _esperando
verificación_. **Una persona distinta del ejecutor** la verifica y la cierra. Si vence sin
cerrarse: +3 días escala al supervisor, +7 días a gerencia. Cada transición es un evento
append-only, no un campo que se sobrescribe.

### R4 — Reporte de incidente en tercera persona

Ocurrió un accidente (choque de montacargas, corte, caída). Un supervisor o gerente entra a
la plataforma **en inglés**, **selecciona a la persona afectada de una lista sin poder ver su
perfil**, clasifica el evento, y describe qué pasó. Registra la categoría de la lesión,
**no el diagnóstico** — eso no entra al sistema.
El sistema muestra los relojes regulatorios que aplican y notifica al coordinador de HS.
**El sistema no envía nada al MLITSD ni al WSIB.** La responsabilidad legal es de una persona.

### R5 — Cumplimiento ante el MLITSD

El coordinador consulta, por sitio, la lista de períodos con inspección completada vs. omitida,
y exporta a PDF con hash del contenido. Esa es la evidencia de cobertura.

---

## 4. Modelo de dominio

### La distinción central: Persona ≠ Usuario

Es la decisión de modelo más importante del sistema y la que resuelve el tercer dolor de Atlas.

- **Persona** — todo el personal (200+). Existe como dato, viene del roster. Puede ser sujeto
  de un incidente o responsable de una acción. **La mayoría nunca inicia sesión.**
- **Usuario** — quien tiene credenciales. Subconjunto pequeño. Referencia a una Persona.

Un supervisor selecciona una **Persona** como sujeto del incidente sin que eso implique darle
acceso al sistema a esa persona, y sin poder ver su perfil.

### Entidades

**Sitio** — St. Thomas, Glencoe. Entidad de primer nivel: atraviesa calendario, permisos,
hallazgos, incidentes y métricas. Calendarios y reportes de cumplimiento son por sitio.

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
| `item_key`                 | El concepto estable, asignado una sola vez al crear el ítem | Analítica: es la clave de agrupación para la detección de hallazgos recurrentes                                                    |

Reglas que el builder debe garantizar:

- **Editar nunca genera `item_key` nueva.** Cambiar la redacción, mover el ítem a otra sección,
  reordenarlo o cambiarle el peso conserva la key. Solo un ítem conceptualmente nuevo recibe
  key nueva.
- `item_key` es inmutable una vez asignada. No se reutiliza, no se recicla.
- **Linaje.** Si un ítem se divide en dos ("guardas en líneas de empaque" → "guardas línea 3" +
  "guardas línea 7") o dos se fusionan en uno, ninguno de los resultantes puede heredar
  limpiamente la key original. Se requiere un campo `replaces_item_key` para dejar rastro, o
  aceptar explícitamente que la serie histórica arranca de cero en ese punto.
- Cambiar el **tipo de respuesta** de un ítem (p. ej. sí/no → escala) conserva la key. Para la
  recurrencia lo que cuenta es que se generó un hallazgo, no el valor de la respuesta. Queda
  registrado como decisión, no como accidente.

**InspecciónProgramada** — sitio, período, un asignado (miembro del JHSC).

**Inspección** — estados: `borrador` (local, editable) → `enviada` (congelada) → opcionalmente
`superada` o `anulada`. Un dueño, un dispositivo, un firmante.

**Respuesta** — valor por ítem dentro de una inspección.

**Hallazgo** — origen, descripción, foto obligatoria, ubicación, clasificación de riesgo,
nivel de jerarquía de controles.
Cuando nace de un ítem de plantilla guarda **los dos identificadores**:
`template_version_item_id` para el registro legal e `item_key` para la agrupación.
Un hallazgo de entrada manual no tiene `item_key` y por lo tanto **queda fuera de la
detección de recurrencia** — consecuencia aceptada, o hay que decidir cómo asociarlo.

**AcciónCorrectiva** — responsable (Persona nombrada), fecha límite, verificador.
Estados: `abierta` → `en progreso` → `esperando verificación` → `cerrada`.
El progreso es un **stream de eventos**, no un campo de estado.

**Incidente** — reportante (Usuario), sujeto (Persona), sitio, clasificación
(primeros auxilios / atención médica / tiempo perdido o trabajo modificado / lesión crítica /
enfermedad ocupacional).

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

| Rol                                     | Alcance                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Miembro JHSC**                        | Ejecuta inspecciones de su sitio. Ve hallazgos e incidentes.                               |
| **Supervisor / Gerente de operaciones** | Crea incidentes en tercera persona. Ejecuta acciones asignadas. No ve incidentes de otros. |
| **Coordinador de HS**                   | Todo. Administra plantillas y roster.                                                      |
| **Gerencia**                            | Lectura completa + dashboards. Recibe escalamientos.                                       |
| **Auditor externo**                     | Solo lectura, alcance acotado por fecha.                                                   |

**No existe un permiso de "no editar".** Nadie edita nada: la inmutabilidad es una propiedad
global del sistema, no un atributo de rol. Eliminar esa frase del vocabulario del proyecto.

### Nota de vocabulario

Los 7 miembros del JHSC son todos **worker reps certificados** y son los únicos que ejecutan
inspecciones. Por lo tanto "inspector" y "miembro del JHSC" son la misma cosa en este sistema.
**Elegir un solo término y usarlo en tablas, endpoints y UI.** Recomendación: `jhsc_member`
como rol, `inspector_id` como campo dentro de la inspección.

---

## 5. Riesgos y decisiones abiertas

### Riesgos altos — merecen spike técnico antes de formalizar

**A. Identidad del ítem entre versiones de plantilla — resuelta por diseño, pendiente de verificar.**

La feature más valiosa del sistema ("la misma guarda falta cuatro meses seguidos") agrupa
hallazgos por ítem. Con builder visual, el coordinador va a editar, reordenar y mover ítems.
Si el hallazgo apunta solo a la fila de la versión, cada edición parte la serie histórica.

**Por qué es el riesgo más peligroso del proyecto:** no produce ningún error. Los IDs existen,
los joins funcionan, la consulta devuelve filas y el dashboard renderiza. Simplemente agrupa
mal — y "agrupa mal" en una detección de patrones se ve idéntico a "no hay patrón". El sistema
va a mostrar una pantalla que dice que no hay hallazgos recurrentes y nadie va a dudar de ella.

_Mitigación:_ identidad dual (`item_key` + `template_version_item_id`) — ver sección 4.

**Prueba de aceptación obligatoria antes de la primera migración.** Tres versiones sucesivas
con ediciones realistas:

1. **v1** — crear el ítem, generar un hallazgo.
2. **v2** — cambiar la redacción, moverlo a otra sección, reordenarlo. Generar dos hallazgos.
3. **v3** — cambiar el tipo de respuesta de sí/no a escala. Generar un hallazgo.

_Aserción:_ la consulta de recurrencia devuelve **una serie de 4**. Si devuelve 1 + 2 + 1, el
esquema está mal y se descubrió antes de tener datos reales.

**Límite conocido:** `item_key` estable es condición necesaria pero no suficiente. Da "la misma
pregunta", no "la misma pregunta en el mismo lugar". Con 48 acres, la clave de recurrencia útil
es `item_key` + ubicación estructurada. Ver pregunta abierta 1 — es el mismo problema de fondo:
qué significa "el mismo problema".

**B. El builder visual es la pieza más cara para el usuario más pequeño.**
Un solo administrador. Tipos de respuesta, lógica condicional, versionado y scoring ponderado.
Decisión tomada: **entra en v1**. Queda registrado que si el proyecto se atrasa, es por acá.

**C. Timestamp autoritativo para el cumplimiento.**
Una inspección llenada el 31 de octubre que sincroniza el 2 de noviembre, ¿a qué período
cuenta? Se almacenan ambos timestamps, pero falta decidir cuál manda ante el MLITSD.
Recomendación: el timestamp de dispositivo al firmar define el período; el de servidor define
el orden en el log. _Requiere decisión explícita._

**D. Pérdida de borradores.**
Los borradores viven solo en IndexedDB. Un teléfono perdido, un caché limpiado o un desalojo
de storage por iOS se lleva una inspección completa sin rastro. Es coherente con "el submit es
el punto de no retorno", pero hoy es un accidente y no una decisión declarada.

**E. Scoring ponderado sin destino.**
Está en el builder pero no aparece en ninguna métrica ni pantalla del documento. O tiene un
consumidor, o sale de v1.

### Riesgos medios

**F. La métrica de casi-accidentes queda vacía.**
Con reporte en tercera persona por personal de supervisión, nadie va a cargar un formulario
por un evento donde no pasó nada. El indicador "volumen de casi-accidentes" de la analítica
va a ser cercano a cero y no va a significar lo que dice la nota interpretativa.
Recomendación pendiente de aceptación: **sacar near-miss de las clasificaciones** y aceptar
que este módulo mide cumplimiento, no prevención. La prevención vive en el módulo de hallazgos.

**G. Fidelidad del relato con la plataforma solo en inglés.**
Un supervisor hispanohablante presencia el accidente y tiene que describirlo en inglés, en un
registro inmutable que puede terminar en un Form 7 del WSIB o en un expediente del MLITSD.
El riesgo no es de código: es que la narrativa quede pobre, ambigua o incompleta justo en el
documento donde la precisión importa más. Mitigaciones posibles sin construir i18n:

- Los campos narrativos aceptan texto en cualquier idioma y registran cuál se usó. Si el
  supervisor escribe en español, el registro conserva sus palabras exactas.
- Campos guiados y estructurados (qué, dónde, cuándo, quién, qué tarea se hacía) en lugar de
  un solo cuadro de texto libre grande. Reducen la carga de redacción.
- **No usar traducción automática** dentro de un registro inmutable.

_Nota:_ si en producción se observa que los supervisores hispanohablantes dejan de reportar o
reportan de segunda mano, esta decisión de alcance hay que revisarla.

**G-bis. La confidencialidad médica no desaparece con la tabla.**
PIPEDA probablemente nunca aplicó: cubre datos de empleados en empleadores de jurisdicción
federal, y un invernadero en Ontario es de jurisdicción provincial. Pero la OHSA restringe la
divulgación de información médica de un trabajador sin su consentimiento. La estrategia adoptada
—**no almacenar detalle clínico en absoluto**— es la forma limpia de cumplir sin construir
compartimentos. Requiere disciplina operativa: si alguien empieza a pegar diagnósticos en el
campo narrativo, el problema regresa por la puerta de atrás y sin control de acceso.

**H. Alcance de "precarga el Form 7".**
Puede significar mostrar los campos en pantalla o generar el PDF oficial del WSIB.
Dos semanas de diferencia. Sin definir.

**I. Ciclo de vida del auditor externo.**
Quién lo crea, cuánto dura el acceso, cómo se revoca. Sin definir. (La pregunta sobre el detalle
médico ya no aplica: no hay detalle médico en el sistema.)

---

## 6. Preguntas resueltas

### Bloquean el modelo de datos

1. **¿La ubicación del hallazgo es texto libre o lista cerrada por sitio?**
   Con 48 acres, "falta guarda en línea de empaque" cuatro meses seguidos puede ser la misma
   línea o cuatro distintas. Texto libre mata la agrupación fina.
   _(B)_ Lista cerrada administrada por el coordinador — un desplegable, sin QR ni GPS.

2. **¿El builder puede borrar un ítem o solo desactivarlo?**
   **Ahora es dependencia directa de la decisión de identidad dual.** El código puede garantizar
   que editar conserva la `item_key`, pero no puede impedir que el coordinador borre un ítem y
   cree otro que significa lo mismo — key nueva, serie partida, y el sistema no se queja.
   Desactivar en lugar de borrar elimina esa tentación de raíz.
   _(A)_ Borrado real — los hallazgos históricos apuntan a un ítem inexistente.

3. **¿El roster es importación por archivo o sincronización con ADP?**
   Existe la lista en Excel y en ADP. Se pidió carga masiva.
   _(A)_ Importación de CSV/Excel cuando cambia algo — manual, controlado, alguien tiene que
   acordarse.

4. ~~**¿El texto en español de un incidente se traduce?**~~ **Cerrada.** La plataforma es solo
   en inglés y no hay traducción de ningún tipo. La narrativa se captura en **campos guiados**,
   no en un cuadro de texto libre único — ver sección 4 para el set de campos y la pregunta 11
   para la consecuencia que abre.

### Bloquean permisos

5. **¿Un miembro del JHSC de St. Thomas ve los hallazgos de Glencoe?**
   Cada lugar de trabajo tiene su JHSC y su obligación propia. Por defecto no, y que
   solo coordinador y gerencia ven ambos sitios.

6. **¿Un supervisor ve los incidentes que él mismo cargó, o ninguno después de enviarlo?**
   La tabla de roles dice que no ve los de otrosl, pero si puede ver los suyos

### Bloquean el módulo de incidentes

7. **¿El incidente tiene estados propios?**
   La acción correctiva tiene máquina de estados definida. El incidente no: se reporta,
   se investiga, ¿y después? No hay un estado de cierre definido ni quién lo declara.

8. **¿Se saca "casi-accidente" de las clasificaciones?** (ver riesgo F)

9. **¿Un hallazgo puede tener varias acciones correctivas, y una acción cubrir varios hallazgos?**
   La fecha límite se deriva de la severidad del hallazgo. Si la relación es muchos-a-muchos,
   falta definir qué severidad manda. Define el modelo relacional.

10. **¿El formulario de incidentes se versiona? ¿Es configurable?**
    Consecuencia directa de elegir campos guiados, y no la habíamos visto. Con un cuadro de
    texto libre no había problema: un string es un string. Con nueve campos estructurados, el
    formulario **es un esquema** — y los esquemas cambian. En seis meses vas a querer agregar
    "turno" o "¿había supervisor presente?".
    Eso devuelve el problema del versionado a un módulo donde creías no tenerlo:
    - Si el formulario no se versiona, los incidentes viejos quedan sin el campo nuevo y no hay
      forma de saber si está vacío porque no aplicaba o porque no existía. En un registro
      inmutable eso no se corrige después.
    - Si se versiona, el `Incidente` apunta a `incident_form_version_id`, igual que la inspección
      apunta a `template_version_id`.
    - Si además es **configurable por el coordinador**, el builder deja de ser solo de plantillas
      de inspección: pasa a tener un segundo consumidor, con su propia lógica de relojes
      regulatorios encima.

    Recomendación: **esquema fijo en código, versionado explícito, no configurable en v1.**
    Los nueve campos son estables, y los plazos legales que dependen de ellos no son algo que
    convenga dejar en manos de un builder visual.

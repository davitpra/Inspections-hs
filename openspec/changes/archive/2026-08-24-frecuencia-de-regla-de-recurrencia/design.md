# Diseño

Toca **dos tablas inmutables**: `inspection_schedule` y `scheduled_inspection`, las dos
bajo el régimen del §5 de `0008_inspection_scheduling.sql`. La migración es
`0029_inspection_frequency.sql`.

## D1 — El período se estira, no se multiplica

La alternativa era que la frecuencia decidiera solo EN QUÉ MESES se abre, dejando cada
inspección cubriendo un mes. Se descarta porque rompe el significado del estado: una
inspección trimestral que cubre enero pero cuya obligación es el trimestre estaría `missed`
el 1 de febrero, cuando todavía faltan dos meses para que el trimestre cierre.

Estirando el período, `periodStatusCase()` **no se toca**: `open` sigue queriendo decir «el
período no cerró» y sigue midiéndose contra `period_end`. Es la señal de que el modelo
elegido es el que ya tenía el sistema, no uno nuevo pegado al costado.

## D2 — Las frecuencias son los divisores de 12

`CHECK (frequency_months IN (1, 3, 6, 12))`. La lista no es una preferencia: el ancla es un
mes de 1 a 12, y eso solo alcanza para decidir si un mes empieza período —sin mirar el
año— cuando la frecuencia divide a 12. Con 5, la respuesta dependería del año en que la
regla nació y el ancla tendría que ser una fecha absoluta.

## D3 — `period_months` se copia, no se lee por join

Misma decisión que 0008 tomó para `template_id` e `inspector_id`, y con las palabras que
esa migración ya usó: **la regla es una fábrica, no un padre**. Si el largo se leyera por
join, la forma de un período de 2026 dependería de una fila que se puede desactivar en
2027, y desactivar una regla reescribiría qué se inspeccionó.

## D4 — La frecuencia y el ancla son inmutables (ADR-002 / ADR-004)

Es la decisión menos obvia y la que más sostiene el resto. El CTE `owed` del reporte de
cumplimiento **no cuenta las inspecciones que existen: genera los períodos que el sitio
DEBÍA a partir de la regla** —eso es design D6 del change de la etapa 7 y es lo que hace
visible el mes que el trabajo nunca abrió—. Entonces cambiarle la frecuencia a una regla
viva no cambia el futuro: **reescribe el pasado**. Un año que se reportó como «12 de 12»
pasaría a leerse «4 de 12» sin que nadie tocara una inspección.

Cambiar la frecuencia es desactivar y crear otra regla. Eso deja las dos ventanas
`created_at`..`deactivated_at` contiguas, que es exactamente lo que el reporte necesita
para decir la verdad sobre los dos tramos. Es además el mismo idioma que ya tienen
`site_id` y `template_id` en esa tabla.

Se aplica por partida doble, como manda ADR-004: fuera del `GRANT UPDATE` (42501 para
`hs_app`) y dentro del array `frozen` del trigger (HS001 para cualquier rol, el dueño
incluido).

## D5 — El trabajo pregunta por el período que CONTIENE al mes (ADR-005)

El `INSERT` no filtra por «hoy es un mes ancla». Calcula, por regla, el inicio del período
que contiene al mes corriente:

```sql
($1::date - (MOD(EXTRACT(MONTH FROM $1::date)::int - s.anchor_month + 12,
                 s.frequency_months) || ' month')::interval)::date
```

ADR-005 puso este cron diario y no mensual para que un día 1 con el servidor caído no
pierda el período. Con el filtro por mes ancla esa propiedad se perdía justo para las
frecuencias nuevas: un trimestre cuyo primer mes pasó caído no se abriría nunca. Preguntando
por el período contenedor, las noventa corridas de un trimestre calculan el mismo
`period_start` y el único parcial absorbe las ochenta y nueve sobrantes — **la idempotencia
no cambia de lugar**.

Consecuencia declarada: una regla trimestral creada a mitad del trimestre abre el trimestre
entero, con `period_start` en el pasado. Es consistente con lo que el reporte ya hacía
(«una regla creada a mitad de mayo hace deber mayo») y evita que la regla no deba nada
hasta la serie siguiente.

## D6 — La aritmética del ancla vive en cuatro lugares

El CTE del reporte, el `INSERT` del trabajo, `period.ts` del servidor y `startsPeriod()`
del cliente. No se pueden unificar: una corre en Postgres, otra en Node, otra en el
navegador, y el cliente no puede importar de `apps/api` (ADR-008). La defensa es que los
tests de las dos copias de TypeScript fijen **los mismos casos**, con el cruce de año hacia
atrás incluido —ancla 11, trimestral, mes de enero— que es el que se rompe primero si
alguien "simplifica" el `+ 12`. Es el mismo recurso que ya se usó para el borde de horario
de verano.

## D7 — `periodLabel` vive en `@hs/contracts`

Es la excepción a la duplicación de D6, y por un motivo concreto: la etiqueta la escribe
también **el PDF que se le entrega al MLITSD**. Tres copias serían tres formas de escribir
«el primer trimestre», y la que envejecería es la del documento regulatorio, que es la
única que alguien va a leer dentro de cinco años. `contracts` es lo que las dos aplicaciones
ya comparten y es puro, así que la función entra sin violar nada.

La etiqueta corta (`Q1`, `H2`, el año a secas) **solo se usa cuando el período cae donde el
calendario la pone**. Una regla trimestral anclada en febrero cubre feb-abr, que no es
ningún trimestre civil; llamarlo «Q1» sería mentir sobre el alcance de la evidencia. En ese
caso se escriben los dos extremos.

## D8 — El payload del reporte sube a `schema_version` 2, y `period_months` es opcional

El payload de un `compliance_report` se guarda tal cual y su digest se calculó sobre ESA
forma. Un campo obligatorio haría que un documento congelado en 2026 dejara de validar
contra el contrato que lo tiene que poder leer en 2031. `period_months` es opcional y su
ausencia **significa algo**: el reporte se congeló antes de 0029, cuando todo período era
mensual por construcción. `compliancePayloadSchema` acepta las dos versiones que sabe leer.

## D9 — El aviso de la bandeja se agrupa por mes, no por período

`notification.dedupe_key` sigue siendo `<site_id>:<mes>`. Con frecuencias mixtas una corrida
puede abrir la mensual de agosto y el trimestre que empieza en agosto: un aviso por período
le mandaría dos tarjetas al coordinador por la misma corrida. El payload cambia de forma —el
período baja del tope a cada entrada de `opened`— porque arriba ya no hay un período único
que nombrar sin mentir sobre el otro.

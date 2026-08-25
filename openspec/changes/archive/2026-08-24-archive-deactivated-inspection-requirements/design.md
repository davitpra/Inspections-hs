## Context

`inspection_schedule.deactivated_at` tiene significado operativo: cierra la ventana de meses que una regla debe y permite crear otra regla para la misma planta y plantilla. No puede reutilizarse para ocultar una fila de administración. La API devuelve todas las reglas visibles por RLS y el cliente usa ese conjunto tanto para la tabla como para proyectar el calendario anual.

El change toca `inspection_schedule`, una tabla inmutable salvo por las columnas concedidas explícitamente. Aplican ADR-002 para las barreras del motor, ADR-004 para el alcance por sitio y ADR-008 para mantener la decisión en el módulo de inspecciones.

## Goals / Non-Goals

**Goals:**

- Separar el retiro visual de una regla de su baja operativa.
- Hacer persistentes, reversibles y auditables el archivo y la restauración.
- Garantizar que archivar no altere proyecciones, períodos ni reporting histórico.

**Non-Goals:**

- Borrar reglas o períodos.
- Permitir archivar una regla activa.
- Convertir el archivo en una segunda forma de desactivación.
- Mostrar o administrar todo el historial de reglas reemplazadas fuera del filtro de archivadas.

## Decisions

### `archived_at` es una marca de presentación independiente

Se agrega un timestamp nulable a `inspection_schedule`. Un `CHECK` exige `archived_at IS NULL OR deactivated_at IS NOT NULL`, y el rol de aplicación recibe `UPDATE` solo sobre esa columna además de las columnas ya permitidas. Se descarta guardar esta preferencia en el navegador porque no sobreviviría otro dispositivo ni produciría auditoría; también se descarta reutilizar `deactivated_at` porque cambiaría obligaciones.

### El mismo PATCH expresa archivo y restauración

El contrato incorpora `archived?: boolean`. El servicio comprueba el estado actual dentro del alcance de la sesión: `true` exige una regla desactivada; `false` exige que no haya otra regla no archivada para el mismo par planta/plantilla. La base conserva además el `CHECK` como defensa frente a escrituras que no pasen por el servicio.

### Restaurar no reactiva

Restaurar solo limpia `archived_at`. La regla vuelve a la tabla como `Deactivated`, desde donde el coordinador decide separadamente si debe reactivarla. Se evita una operación compuesta que podría chocar con el índice único de reglas activas y esconder qué decisión se tomó.

### El filtrado ocurre solo en la tabla de requisitos

La colección completa sigue alimentando `projectYear`, filtros y reporting. `RequirementsSection` deriva por separado las reglas no archivadas actuales y las archivadas. El control `Show archived` agrega las archivadas a la tabla; no modifica el calendario. Las claves de fila usan `inspection_schedule.id` porque una plantilla puede tener una regla actual y otra archivada.

### Archivo y restauración producen eventos propios

El trigger existente de `inspection_schedule` agrega `inspection_schedule.archived` y `inspection_schedule.restored`. No se reutiliza `deactivated`, porque los eventos responden preguntas regulatorias distintas y el payload debe conservar el timestamp resultante.

## Risks / Trade-offs

- [Una regla archivada puede ser reemplazada antes de restaurarse] → La restauración se rechaza si existe otra regla no archivada para la misma planta y plantilla; la fila permanece consultable con `Show archived`.
- [Filtrar demasiado pronto podría borrar obligaciones de la proyección] → El archivo se filtra exclusivamente en `RequirementsSection`, con una prueba que fija que `projectYear` conserva la regla.
- [Dos restauraciones concurrentes podrían pasar una comprobación previa] → Crear o restaurar toma un bloqueo transaccional por el par planta/plantilla; la actualización conserva además un predicado `NOT EXISTS` en la misma sentencia y comprueba `rowCount`. El aislamiento RLS sigue aplicándose.

## Migration Plan

1. Agregar `archived_at` y el `CHECK` con todas las filas existentes en null.
2. Actualizar el trigger de guarda y conceder `UPDATE (archived_at)` a `hs_app`, sin conceder `DELETE` ni actualización amplia.
3. Actualizar el trigger de auditoría.
4. Desplegar contratos, API y web juntos; el campo nuevo es obligatorio en la respuesta pero todas las filas migradas devuelven null.

Rollback: retirar primero el uso desde aplicación y después eliminar trigger, restricción y columna en una migración explícita. Los eventos ya escritos permanecen en el log append-only.

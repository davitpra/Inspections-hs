# ADR-010 — Dispositivos objetivo: Android, con sincronización dentro de los 7 días

|                             |                                                       |
| --------------------------- | ------------------------------------------------------- |
| **Estado**                  | Aceptada                                              |
| **Fecha**                   | 2026-08-06                                            |
| **Origen**                  | S2 de `Stack_Tecnologico_V1.md`                       |
| **Supersede**               | —                                                     |
| **Superada por**            | —                                                     |
| **Referencias**             | `docs/requisitos-v1.2.md` riesgo D, §6 (Dispositivos); ADR-001 |
| **Changes que la consumen** | `offline-inspection-capture`                          |

## Decisión

Los 7 miembros del JHSC usan **Android**. Esto elimina el desalojo de IndexedDB de Safari
como riesgo principal y hace tratable el riesgo D de `docs/requisitos-v1.2.md`.

**Supuesto operativo declarado:** una inspección iniciada se sincroniza dentro de los 7 días.
Con periodicidad mensual y un recorrido que dura horas, es holgado.

## Mitigaciones obligatorias

Ahora como refuerzo y no como salvavidas:

- `navigator.storage.persist()` en el arranque de la app.
- Instalación en pantalla de inicio como paso del onboarding.
- **Indicador permanente en la UI**: "N respuestas sin enviar, borrador de hace X días."
  Es la mitigación que convierte el supuesto en algo verificable por el usuario.
- Advertencia visible si el borrador supera los 3 días sin sincronizar.

## Consecuencia sobre el spike 1

Se ejecuta en un dispositivo Android real. Se puede omitir la verificación de persistencia
en iOS.

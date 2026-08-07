# ADR-003 — Cliente con Vite, no Next.js

|                             |                                                        |
| --------------------------- | ------------------------------------------------------ |
| **Estado**                  | Aceptada, con alternativa documentada                  |
| **Fecha**                   | 2026-08-06                                             |
| **Supersede**               | —                                                      |
| **Superada por**            | —                                                      |
| **Referencias**             | `docs/requisitos-v1.2.md` R1; ADR-001, ADR-007         |
| **Changes que la consumen** | `offline-inspection-capture`, `template-builder-*`     |

## Contexto

La aplicación es 100% autenticada, sin páginas públicas, sin SEO, con ~15 usuarios
concurrentes en el peor caso, y su recorrido crítico (R1) ocurre **sin red**.

Next.js está optimizado para exactamente lo contrario. En este proyecto no aporta ningún
beneficio y sí introduce fricción real entre el App Router / RSC y el control fino del
service worker y del caché de rutas offline.

## Decisión

**Vite + React + TanStack Router + TanStack Query.**

Alternativa aceptable si se prioriza velocidad de arranque sobre limpieza: Next.js en modo
static export, con todo el módulo de inspección como client-only. **No** App Router con RSC.

## Consecuencias

- Toda la autenticación es del lado del cliente contra la API de NestJS. No hay middleware
  de servidor en el borde.
- El build es un bundle estático servible desde cualquier CDN u origen.

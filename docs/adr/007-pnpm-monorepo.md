# ADR-007 — Monorepo con pnpm workspaces

|                             |                                                    |
| --------------------------- | ---------------------------------------------------- |
| **Estado**                  | Aceptada                                           |
| **Fecha**                   | 2026-08-06                                         |
| **Supersede**               | —                                                  |
| **Superada por**            | —                                                  |
| **Referencias**             | ADR-001, ADR-003, ADR-004                          |
| **Changes que la consumen** | `bootstrap-immutable-persistence`, `shared-forms-engine` |

## Contexto

No se adopta por conveniencia de tooling. Se adopta por una consecuencia directa de ADR-001:
**el dispositivo tiene que interpretar la plantilla sin red.**

El builder produce un documento de `template_version`. En el invernadero, sin señal, el
cliente renderiza los tipos de respuesta y evalúa la lógica condicional a partir de ese
documento. Cuando el envío llega, el servidor re-valida la sumisión contra esa misma versión
antes de escribirla en un registro inmutable.

Si esas dos implementaciones divergen, el modo de falla es el peor posible: el inspector
recorre 48 acres, firma, sincroniza, y el servidor rechaza — o acepta con semántica distinta
y queda congelado. El motor de formularios tiene que ser **un solo paquete importado por los
dos lados**.

## Estructura

```
apps/
  web/          Vite + React + PWA
  api/          NestJS
packages/
  forms/        Motor de formularios: tipos de ítem, lógica condicional,
                validación de respuestas contra una template_version
  contracts/    Zod de request/response + tipos derivados
  config/       tsconfig, eslint compartidos
```

## Reglas que importan más que la estructura

**`packages/forms` no puede tener dependencias de Node.** Se empaqueta dentro del bundle del
service worker. Sin `fs`, sin librerías que asuman servidor. Se aplica por regla de lint
desde el primer commit, no por disciplina.

**El esquema de Drizzle no se comparte.** Vive solo en `apps/api`. El cliente consume DTOs
derivados de `contracts`, nunca tipos de tabla. Filtrar tipos de base de datos al cliente
acopla el frontend a decisiones de RLS y de append-only que no le incumben.

## Herramienta

**pnpm workspaces solo. Sin Nx, sin Turborepo.** Con dos apps y tres paquetes, el caché de
builds ahorra segundos y cuesta un archivo de configuración más. Se agrega Turborepo si
alguna vez el CI tarda lo suficiente como para molestar; es una tarde de trabajo y no una
decisión que haya que tomar hoy.

## Nota operativa

NestJS tiene fricción con el hoisting de pnpm en el build de producción. Se resuelve con
`node-linker=hoisted` en `.npmrc` o empaquetando la API con `nest build --webpack`. Media
hora al inicio; si no, aparece el día del primer deploy.

## Lo que el monorepo no implica

Deploy conjunto. `apps/web` es un bundle estático y `apps/api` un contenedor. Pipelines
separados, versionado conjunto.

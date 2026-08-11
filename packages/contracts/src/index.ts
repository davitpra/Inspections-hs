import { z } from 'zod';

/**
 * Contratos de request/response entre `apps/web` y `apps/api`.
 *
 * ADR-007: el cliente consume DTOs derivados de acá, nunca tipos de tabla de
 * Drizzle. El esquema de base de datos vive solo en `apps/api`.
 */

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export * from './actions.js';
export * from './auth.js';
export * from './catalog.js';
export * from './field-package.js';
export * from './findings.js';
export * from './identity.js';
export * from './incidents.js';
export * from './inspections.js';
export * from './notifications.js';
export * from './regulatory-clocks.js';
export * from './submissions.js';
export * from './template-document.js';

import { z } from 'zod';

/**
 * Lo que un ítem PRESCRIBE para cuando su respuesta falla: el texto de la acción
 * correctiva que la organización decidió al publicar la plantilla, y el umbral
 * que convierte un número en una falla.
 *
 * Acá vivía además la jerarquía de controles, retirada con la clasificación de
 * riesgo (ADR-014). Lo prescrito se muestra y lo observado se escribe; este
 * archivo es solo la mitad prescrita.
 */
export const FAILURE_OPERATORS = ['lt', 'lte', 'gt', 'gte'] as const;

export const failureOperatorSchema = z.enum(FAILURE_OPERATORS);

export type FailureOperator = z.infer<typeof failureOperatorSchema>;

export const failureThresholdSchema = z.strictObject({
  operator: failureOperatorSchema,
  value: z.number(),
});

export type FailureThreshold = z.infer<typeof failureThresholdSchema>;

export const findingSchema = z.strictObject({
  corrective_action: z.string(),
  fails_when: failureThresholdSchema.optional(),
});

export type FindingPrescription = z.infer<typeof findingSchema>;

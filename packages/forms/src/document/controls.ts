import { z } from 'zod';

/**
 * La jerarquía de controles, de la más efectiva a la menos. El sistema registra
 * el nivel de la solución propuesta y no lo juzga: que la respuesta a un riesgo
 * crítico haya sido un par de guantes es exactamente el dato que hace falta ver.
 */
export const CONTROL_LEVELS = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'ppe',
] as const;

export const controlLevelSchema = z.enum(CONTROL_LEVELS);

export type ControlLevel = z.infer<typeof controlLevelSchema>;

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
  control_level: controlLevelSchema,
  fails_when: failureThresholdSchema.optional(),
});

export type FindingPrescription = z.infer<typeof findingSchema>;

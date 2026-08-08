import { z } from 'zod';

import type { ResponseType } from './schema.js';

/**
 * La forma de una respuesta, por tipo de ítem.
 *
 * Es la otra mitad del contrato del documento: el documento dice qué se
 * pregunta, esto dice qué se puede contestar. Cliente y servidor tipan contra lo
 * mismo, que es la única razón por la que el motor vive en un paquete (ADR-007).
 */

/** `na` no es un incumplimiento: es "esta pregunta no aplica a este recorrido". */
export const YES_NO_NA_VALUES = ['yes', 'no', 'na'] as const;

export const yesNoNaSchema = z.enum(YES_NO_NA_VALUES);

export type YesNoNa = z.infer<typeof yesNoNaSchema>;

/**
 * La firma viaja como object key, igual que las fotos (ADR-001): se sube antes
 * del envío y el envío la referencia. `signed_at` es el reloj del dispositivo —
 * el servidor guarda además el suyo, según el riesgo C de requisitos §5.
 */
export const signatureAnswerSchema = z.strictObject({
  object_key: z.string().min(1),
  signed_at: z.string().min(1),
});

export type SignatureAnswer = z.infer<typeof signatureAnswerSchema>;

/** La respuesta que corresponde a un `response_type`. */
export type AnswerFor<T extends ResponseType> = {
  yes_no: boolean;
  yes_no_na: YesNoNa;
  scale: number;
  text: string;
  number: number;
  single_choice: string;
  multi_choice: string[];
  photo: string[];
  signature: SignatureAnswer;
}[T];

/** Cualquier respuesta válida para algún tipo de ítem. */
export type Answer = AnswerFor<ResponseType>;

/**
 * Las respuestas de una inspección, por `item_key`. Una key ausente es un ítem
 * sin contestar; el motor decide si eso es una violación según `required` y
 * según la visibilidad.
 */
export type AnswerSet = Readonly<Record<string, unknown>>;

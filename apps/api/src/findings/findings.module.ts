import { Module } from '@nestjs/common';

import { FindingsController } from './findings.controller';
import { FindingsService } from './findings.service';

/**
 * Requisitos §7 etapa 4 — El módulo de hallazgos de ADR-008.
 *
 * **No exporta nada, y `inspections` no lo importa.** La ingesta usa `derive.ts`, que
 * son funciones puras: no hace falta un provider para llamarlas, y pedirle a Nest que
 * inyecte una función pura sería ceremonia sin nada que resolver.
 *
 * Esa es también la razón por la que la excepción de ADR-008 —`inspections` conoce
 * `findings`— no crea un acoplamiento de módulos de Nest, solo un import de archivo.
 */
@Module({
  controllers: [FindingsController],
  providers: [FindingsService],
})
export class FindingsModule {}

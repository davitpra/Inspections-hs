## 1. API de baja

- [x] 1.1 Añadir errores estables y la ruta `PATCH /people/:personId` para solicitar la baja lógica.
- [x] 1.2 Implementar en servicio y repositorio la actualización condicional, acotada por RLS, de una persona activa sin cuenta.
- [x] 1.3 Cubrir con pruebas de integración el éxito, auditoría, permisos, alcance, cuenta asociada, repetición e inexistencia.

## 2. Interfaz del roster

- [x] 2.1 Añadir al cliente web la mutación tipada de baja lógica de una persona.
- [x] 2.2 Ofrecer una acción destructiva solo en filas Worker activas y transportar el `personId` al diálogo.
- [x] 2.3 Implementar el diálogo de confirmación, sus estados de carga/error y la invalidación del roster tras el éxito.
- [x] 2.4 Cubrir las reglas puras y el flujo completo de la ruta con pruebas web.

## 3. Verificación

- [x] 3.1 Ejecutar las pruebas unitarias e integración específicas del roster y corregir regresiones.
- [x] 3.2 Ejecutar `pnpm -r build`, `pnpm typecheck` y `pnpm lint`.
- [x] 3.3 Validar estrictamente el change de OpenSpec.

## 4. Coherencia de Worker

- [x] 4.1 Permitir la baja cuando la cuenta asociada existe pero está inactiva, manteniendo el rechazo de cuentas activas.
- [x] 4.2 Hacer que la acción use la misma regla que presenta la fila como Worker.
- [x] 4.3 Cubrir ambos estados de cuenta con pruebas de integración y web.
- [x] 4.4 Repetir build, typecheck, lint y validación estricta de OpenSpec.

## 1. La decisión, sin renderizar

- [x] 1.1 Retirar `writes` de `FindingNextStep` y de las dos ramas de `nextStep`.
- [x] 1.2 Reducir `openableStages` a las etapas alcanzadas y reescribir su argumento.
- [x] 1.3 Cubrir las dos con pruebas unitarias: ninguna etapa por delante se ofrece.

## 2. El ciclo dibujado

- [x] 2.1 Abrir la etapa vigente por defecto y dibujar el paso dentro de su registro.
- [x] 2.2 Retirar el segmento borrador de la tira de etapas y su estilo en `index.css`.
- [x] 2.3 Retirar la rama de registro vacío, conservando el aviso de registro ilegible.
- [x] 2.4 Reescribir los bloques de documentación que argumentaban a favor del borrador.

## 3. Verificación

- [x] 3.1 Cubrir con pruebas de ruta las cinco etapas: registro y paso en la misma pestaña.
- [x] 3.2 Ejecutar pruebas específicas, lint, build y typecheck en el orden del repositorio.
- [x] 3.3 Validar estrictamente el change de OpenSpec.

import { describe, expect, it } from 'vitest';

import { templateKeyFromName } from './template-key';

describe('templateKeyFromName', () => {
  it('deriva la clave del nombre', () => {
    expect(templateKeyFromName('Monthly electrical inspection')).toBe(
      'monthly-electrical-inspection',
    );
  });

  it('no recorta palabras: el nombre de una plantilla ya es corto', () => {
    expect(templateKeyFromName('Monthly general workplace inspection')).toBe(
      'monthly-general-workplace-inspection',
    );
  });

  it('ignora mayúsculas, espacios de más y puntuación', () => {
    expect(templateKeyFromName('  Monthly   Electrical!  ')).toBe('monthly-electrical');
  });

  it('saca los acentos', () => {
    expect(templateKeyFromName('Inspección eléctrica')).toBe('inspeccion-electrica');
  });

  it('acepta dígitos', () => {
    expect(templateKeyFromName('Form 7 review')).toBe('form-7-review');
  });

  /**
   * El caso que obliga a devolver `null` y no `''`: sin esto el llamador descubriría el
   * problema recién en el `CHECK` de la migración, con un error que no menciona el nombre.
   */
  it('devuelve null cuando el nombre no deja nada utilizable', () => {
    expect(templateKeyFromName('???')).toBeNull();
    expect(templateKeyFromName('   ')).toBeNull();
    expect(templateKeyFromName('')).toBeNull();
    expect(templateKeyFromName('—–—')).toBeNull();
  });

  /**
   * NO desempata. Dos nombres que derivan a la misma clave son una colisión que el servicio
   * reporta como un nombre demasiado parecido; agregar un sufijo acá haría que
   * `key = f(name)` dejara de ser cierto sin que nadie lo viera.
   */
  it('es una función pura del nombre, sin sufijos ni estado', () => {
    expect(templateKeyFromName('Monthly electrical!')).toBe(
      templateKeyFromName('Monthly electrical'),
    );
  });

  it('lo que produce respeta el patrón que exige la base', () => {
    for (const name of ['Monthly electrical', 'Form 7', 'A', 'Inspección 2 — eléctrica']) {
      const key = templateKeyFromName(name);

      expect(key, name).not.toBeNull();
      expect(key).toMatch(/^[a-z0-9]+([.-][a-z0-9]+)*$/);
    }
  });
});

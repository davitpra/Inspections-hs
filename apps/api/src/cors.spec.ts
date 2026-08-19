import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CORS_METHODS, allowedOrigins } from './cors';

/**
 * El preflight cubre todo verbo que la API expone.
 *
 * POR QUÉ ESTE TEST EXISTE. `PUT` entró con el guardado de un borrador de plantilla y no
 * se agregó a `CORS_METHODS`. El resultado no fue un 405 ni un error del servidor: el
 * navegador manda un `OPTIONS` antes de cualquier `PUT`, la respuesta no lo listaba, y el
 * `fetch` moría con «Failed to fetch» —sin status, sin cuerpo y sin ninguna pista de que
 * el problema fuera CORS—. La pantalla mostraba el mensaje de un guardado rechazado, que
 * es exactamente lo que NO estaba pasando.
 *
 * Y no lo atrapó ninguna de las 1.351 pruebas de la suite, porque **ninguna atraviesa una
 * capa CORS**: las de `apps/web` mockean el módulo de API, y las de integración llaman al
 * servicio directo. Una prueba HTTP de extremo a extremo lo habría visto, pero el agujero
 * es más barato de tapar acá: la pregunta real es si la lista de verbos permitidos cubre
 * la lista de verbos mapeados, y las dos se pueden leer sin levantar nada.
 *
 * SE LEE EL FUENTE, NO EL ROUTER DE NEST. Enumerar las rutas de verdad exigiría compilar
 * el `AppModule` entero, que abre la base y depende de `pg-boss`. Leer los decoradores es
 * una aproximación, y es la aproximación correcta: si alguien escribe `@Put(...)` en un
 * controller, este test lo ve, que es todo lo que hace falta para que la lista no se
 * quede corta otra vez.
 */

const HTTP_DECORATOR = /@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/g;

/** Los `*.controller.ts` de `src/`, recorriendo los módulos. */
function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return controllerFiles(path);

    return entry.isFile() && entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

/** Los verbos que un archivo mapea, en mayúsculas y sin repetir. */
function mappedMethods(file: string): string[] {
  const source = readFileSync(file, 'utf8');

  return [...new Set([...source.matchAll(HTTP_DECORATOR)].map((match) => match[1]!.toUpperCase()))];
}

const controllers = controllerFiles(join(__dirname));

describe('CORS_METHODS', () => {
  it('encuentra los controllers de la aplicación', () => {
    // Si el recorrido se rompe, el resto de este archivo pasaría sin comprobar nada.
    expect(controllers.length).toBeGreaterThan(5);
  });

  it.each(controllers.map((file) => [file.slice(__dirname.length + 1), file] as const))(
    '%s no mapea ningún verbo que el preflight rechace',
    (_name, file) => {
      const mapped = mappedMethods(file);
      const missing = mapped.filter(
        // `ALL`, `HEAD` y `OPTIONS` no son verbos que el cliente pida autorizar: `HEAD` va
        // con `GET` en la especificación de CORS y `OPTIONS` ES el preflight.
        (method) => !['ALL', 'HEAD', 'OPTIONS'].includes(method) && !CORS_METHODS.includes(method as (typeof CORS_METHODS)[number]),
      );

      expect(missing, `verbos mapeados pero no permitidos: ${missing.join(', ')}`).toEqual([]);
    },
  );

  it('incluye el PUT del guardado de un borrador de plantilla', () => {
    // El caso concreto que originó el test. Explícito para que borrar `PUT` de la lista
    // falle con un mensaje que diga qué se rompió, y no solo en el `it.each` de arriba.
    expect(CORS_METHODS).toContain('PUT');
  });

  it('no lleva verbos que ningún controller mapea', () => {
    const mapped = new Set(controllers.flatMap(mappedMethods));

    // Al revés que el resto: una lista que crece sin que nadie la use es permiso de más.
    // `DELETE` es la excepción conocida —no hay ninguno, y no debería haberlo nunca: el
    // invariante del proyecto es que nada se borra— pero se deja permitido porque quitarlo
    // no protege de nada y volver a agregarlo costaría este mismo diagnóstico.
    const unused = CORS_METHODS.filter((method) => method !== 'DELETE' && !mapped.has(method));

    expect(unused, `permitidos pero sin usar: ${unused.join(', ')}`).toEqual([]);
  });
});

describe('allowedOrigins', () => {
  it('nunca devuelve un comodín', () => {
    expect(allowedOrigins()).not.toContain('*');
  });

  it('sin WEB_ORIGINS cae al servidor de desarrollo de Vite', () => {
    const previous = process.env.WEB_ORIGINS;
    delete process.env.WEB_ORIGINS;

    try {
      expect(allowedOrigins()).toEqual(['http://localhost:5173', 'http://localhost:4173']);
    } finally {
      if (previous !== undefined) process.env.WEB_ORIGINS = previous;
    }
  });

  it('recorta los espacios de una lista configurada', () => {
    const previous = process.env.WEB_ORIGINS;
    process.env.WEB_ORIGINS = 'https://a.example , https://b.example';

    try {
      expect(allowedOrigins()).toEqual(['https://a.example', 'https://b.example']);
    } finally {
      if (previous === undefined) delete process.env.WEB_ORIGINS;
      else process.env.WEB_ORIGINS = previous;
    }
  });
});

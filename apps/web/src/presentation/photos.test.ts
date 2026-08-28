import { describe, expect, it } from 'vitest';

import { photoStateClass, photoStateLabel } from './photos';

describe('photoStateLabel', () => {
  /**
   * Una foto recién sacada está pendiente por diseño (ADR-001: las fotos suben antes del
   * envío, no al capturarlas). El texto tiene que decir dónde está —guardada— y no
   * anunciar un fallo que no ocurrió.
   */
  it('dice que la foto pendiente está guardada en el dispositivo', () => {
    expect(photoStateLabel('pending')).toBe('Saved on device');
  });

  it('nombra la subida hecha y la que falló', () => {
    expect(photoStateLabel('uploaded')).toBe('Uploaded');
    expect(photoStateLabel('failed')).toBe('Upload failed — will retry');
  });
});

describe('photoStateClass', () => {
  it('solo el fallo se pinta como aviso', () => {
    expect(photoStateClass('failed')).toBe('photos__state photos__state--failed');
    expect(photoStateClass('pending')).toBe('photos__state');
    expect(photoStateClass('uploaded')).toBe('photos__state');
  });
});

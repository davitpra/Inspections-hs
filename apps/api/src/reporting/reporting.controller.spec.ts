import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { ReportingController } from './reporting.controller';

describe('ReportingController', () => {
  it('registra únicamente recurrence y conserva su ruta', () => {
    const methods = Object.getOwnPropertyNames(ReportingController.prototype).filter(
      (name) => name !== 'constructor',
    );

    expect(methods).toEqual(['recurrence']);
    expect(Reflect.getMetadata(PATH_METADATA, ReportingController)).toBe('/');
    expect(Reflect.getMetadata(PATH_METADATA, ReportingController.prototype.recurrence)).toBe(
      'findings/recurrence',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, ReportingController.prototype.recurrence)).toBe(
      RequestMethod.GET,
    );
  });
});

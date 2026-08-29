import { describe, expect, it } from 'vitest';

import { findingsLabel, photoCountText } from './findings';

describe('photoCountText', () => {
  it('nombra la ausencia en vez de callarla', () => {
    expect(photoCountText(0)).toBe('No photos');
    expect(photoCountText(1)).toBe('1 photo');
    expect(photoCountText(3)).toBe('3 photos');
  });
});

describe('findingsLabel', () => {
  it('concuerda en número', () => {
    expect(findingsLabel(1)).toBe('1 finding');
    expect(findingsLabel(3)).toBe('3 findings');
  });
});

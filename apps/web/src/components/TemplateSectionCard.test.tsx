import type { TemplateSection } from '@hs/forms';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TemplateSectionCard } from './TemplateSectionCard';

const SECTION = {
  section_key: 'machine-guarding',
  section_title: 'Machine guarding',
  position: 1,
  items: [
    {
      item_key: 'guard-in-place',
      prompt: 'Is the guard in place?',
      position: 1,
      response_type: 'yes_no',
      fails_on: 'no',
      required: true,
    },
  ],
} satisfies TemplateSection;

afterEach(() => {
  cleanup();
});

describe('TemplateSectionCard', () => {
  it('compone el encabezado publicado con el contenido propio de cada ruta', () => {
    render(
      <TemplateSectionCard
        section={SECTION}
        index={0}
        appliesTo="Both plants"
        condition="Shown when another answer is yes"
        headerAccessory={<span>2 answered</span>}
      >
        <li>Is the guard in place?</li>
      </TemplateSectionCard>,
    );

    expect(screen.getByRole('heading', { name: 'Machine guarding' })).toBeTruthy();
    expect(screen.getByText('Both plants')).toBeTruthy();
    expect(screen.getByText('Shown when another answer is yes')).toBeTruthy();
    expect(screen.getByText('2 answered')).toBeTruthy();
    expect(screen.getByText('Is the guard in place?')).toBeTruthy();
  });

  it('desmonta el contenido al plegar y lo vuelve a montar al abrir', () => {
    render(
      <TemplateSectionCard section={SECTION} index={0} condition="Conditional section">
        <li>Question control</li>
      </TemplateSectionCard>,
    );

    const collapse = screen.getByRole('button', { name: 'Collapse Machine guarding' });
    fireEvent.click(collapse);

    expect(collapse.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Conditional section')).toBeNull();
    expect(screen.queryByText('Question control')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Machine guarding' }));

    expect(screen.getByText('Conditional section')).toBeTruthy();
    expect(screen.getByText('Question control')).toBeTruthy();
  });
});

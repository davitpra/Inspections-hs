import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedTemplateVersion } from '@hs/contracts';

import { PublishedTemplateRoute } from './index';

const getPublishedTemplateVersion = vi.hoisted(() => vi.fn());

vi.mock('../../api/templates', () => ({ getPublishedTemplateVersion }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => {
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to,
    );

    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  useParams: () => ({ versionId: '77777777-7777-4777-8777-777777777777' }),
}));

const version: PublishedTemplateVersion = {
  template_id: '66666666-6666-4666-8666-666666666666',
  template_version_id: '77777777-7777-4777-8777-777777777777',
  key: 'machine-guarding',
  name: 'Machine guarding',
  version: 1,
  published_at: '2026-08-22 10:00:00+00',
  document: {
    sections: [
      {
        section_key: 'second',
        section_title: 'Second section',
        position: 2,
        items: [
          {
            item_key: 'second.question',
            prompt: 'Second question',
            position: 1,
            required: false,
            response_type: 'yes_no',
          },
        ],
      },
      {
        section_key: 'first',
        section_title: 'First section',
        organization_location_code: 'shipping-dock',
        position: 1,
        items: [
          {
            item_key: 'first.trigger',
            prompt: 'Is the guard in place?',
            position: 1,
            required: true,
            response_type: 'yes_no',
          },
          {
            item_key: 'first.temperature',
            prompt: 'What is the temperature?',
            position: 2,
            required: true,
            response_type: 'number',
            min: 0,
            max: 100,
            decimals: 1,
            visible_when: { item_key: 'first.trigger', operator: 'equals', value: false },
            finding: {
              corrective_action: 'Stop the machine and investigate the temperature.',
              fails_when: { operator: 'gt', value: 80 },
            },
          },
        ],
      },
    ],
  },
};

function renderRoute(): void {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PublishedTemplateRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getPublishedTemplateVersion.mockReset().mockResolvedValue(version);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PublishedTemplateRoute', () => {
  it('dibuja secciones e ítems en orden y muestra el registro completo', async () => {
    renderRoute();

    expect(await screen.findByRole('heading', { name: 'Machine guarding' })).toBeTruthy();
    const headings = screen.getAllByRole('heading');
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Machine guarding',
      'First section',
      'Is the guard in place?',
      'What is the temperature?',
      'Second section',
      'Second question',
    ]);
    expect(screen.getByText('shipping-dock')).toBeTruthy();
    expect(screen.getAllByText('Required')).toHaveLength(2);
    expect(screen.getByText('Range: 0 to 100')).toBeTruthy();
    expect(screen.getByText('Decimal places: 1')).toBeTruthy();
    expect(screen.getByText('Corrective action: Stop the machine and investigate the temperature.')).toBeTruthy();
    expect(screen.getByText('Fails above 80')).toBeTruthy();
    expect(screen.getByText('Shown when Is the guard in place? is false')).toBeTruthy();
    expect(screen.getByText(/This version is frozen/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('dice que la lectura necesita conexión cuando falla la red', async () => {
    getPublishedTemplateVersion.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(
      await screen.findByText(/This published template could not be loaded. Reading it needs a connection/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to templates' })).toBeTruthy();
  });

  it('vuelve a Templates desde el encabezado', async () => {
    renderRoute();

    await screen.findByRole('heading', { name: 'Machine guarding' });

    await waitFor(() => expect(screen.getByRole('link', { name: 'Back to templates' })).toBeTruthy());
  });
});

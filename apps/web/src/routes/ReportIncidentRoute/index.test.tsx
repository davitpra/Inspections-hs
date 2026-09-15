import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Location, PersonOption, Session, Site } from '@hs/contracts';

import { ReportIncidentRoute } from './index';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const REPORTER = '44444444-4444-4444-8444-444444444444';
const SUBJECT_A = '55555555-5555-4555-8555-555555555555';
const WITNESS_A = '66666666-6666-4666-8666-666666666666';
const SUBJECT_B = '77777777-7777-4777-8777-777777777777';
const LOCATION_A = '88888888-8888-4888-8888-888888888888';
const LOCATION_B = '99999999-9999-4999-8999-999999999999';

const listSites = vi.hoisted(() => vi.fn());
const listCatalogLocations = vi.hoisted(() => vi.fn());
const listIncidentRoster = vi.hoisted(() => vi.fn());
const reportIncident = vi.hoisted(() => vi.fn());
const useAppSession = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ listSites }));
vi.mock('../../api/catalog', () => ({ listCatalogLocations }));
vi.mock('../../api/incidents', () => ({ listIncidentRoster, reportIncident }));
vi.mock('../../app/session-context', () => ({ useAppSession }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

const sites: Site[] = [
  { id: SITE_A, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null },
  { id: SITE_B, code: 'glencoe', name: 'Glencoe', deactivated_at: null },
];

const locations: Location[] = [
  { id: LOCATION_A, site_id: SITE_A, code: 'line-a', name: 'Line A', deactivated_at: null },
  { id: LOCATION_B, site_id: SITE_B, code: 'line-b', name: 'Line B', deactivated_at: null },
];

const rosterA: PersonOption[] = [
  { id: REPORTER, employee_number: 'E-REPORTER', first_name: 'Report', last_name: 'User' },
  { id: SUBJECT_A, employee_number: 'DEMO-1001', first_name: 'Alex', last_name: 'Boivin' },
  { id: WITNESS_A, employee_number: 'DEMO-1002', first_name: 'Priya', last_name: 'Raman' },
];
const rosterB: PersonOption[] = [
  { id: SUBJECT_B, employee_number: 'DEMO-2001', first_name: 'Chen', last_name: 'Wu' },
];

function session(role: Session['role'] = 'management'): { account: Session } {
  return {
    account: { userId: USER, personId: REPORTER, role, siteScope: [SITE_A, SITE_B] },
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ReportIncidentRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAppSession.mockReset().mockReturnValue(session());
  listSites.mockReset().mockResolvedValue(sites);
  listCatalogLocations.mockReset().mockResolvedValue(locations);
  listIncidentRoster.mockReset().mockImplementation((siteId: string) =>
    Promise.resolve(siteId === SITE_A ? rosterA : rosterB),
  );
  reportIncident.mockReset().mockResolvedValue({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReportIncidentRoute', () => {
  it('fija una sola planta sin mostrar un selector', async () => {
    useAppSession.mockReturnValue({
      account: { ...session().account, siteScope: [SITE_A] },
    });

    renderRoute();

    expect(await screen.findByText('St. Thomas', {}, { timeout: 1000 })).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(await screen.findByRole('option', { name: 'Line A' })).toBeTruthy();
  }, 30000);

  it('cambia de planta y vacía ubicación, sujeto y testigos', async () => {
    renderRoute();

    await screen.findByRole('option', { name: 'Line A' });
    fireEvent.change(screen.getByLabelText('Where'), { target: { value: LOCATION_A } });
    fireEvent.change(screen.getByLabelText('Search affected person'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /DEMO-1001/ }));
    fireEvent.change(screen.getByLabelText('Search witnesses'), { target: { value: 'Priya' } });
    fireEvent.click(await screen.findByRole('button', { name: /DEMO-1002/ }));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Site' }));
    fireEvent.click(screen.getByRole('option', { name: 'Glencoe' }));

    await waitFor(() => expect(listIncidentRoster).toHaveBeenLastCalledWith(SITE_B));
    await screen.findByRole('option', { name: 'Line B' });
    expect((screen.getByLabelText('Where') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Search affected person') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/DEMO-1002/)).toBeNull();
  }, 30000);

  it('no ofrece al reportante como sujeto ni al sujeto como testigo', async () => {
    renderRoute();

    const subjectSearch = await screen.findByLabelText('Search affected person');
    fireEvent.change(subjectSearch, { target: { value: 'Report' } });
    expect(screen.queryByRole('button', { name: /E-REPORTER/ })).toBeNull();

    fireEvent.change(subjectSearch, { target: { value: 'Alex' } });
    fireEvent.click(await screen.findByRole('button', { name: /DEMO-1001/ }));
    fireEvent.change(screen.getByLabelText('Search witnesses'), { target: { value: 'Alex' } });
    expect(screen.queryByText(/DEMO-1001/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'DEMO-1001 — Alex Boivin' })).toBeNull();
  }, 30000);

  it('envía los identificadores elegidos desde las listas', async () => {
    renderRoute();

    await screen.findByRole('option', { name: 'Line A' });
    fireEvent.change(screen.getByLabelText('Where'), { target: { value: LOCATION_A } });
    fireEvent.change(screen.getByLabelText('Search affected person'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /DEMO-1001/ }));
    fireEvent.change(screen.getByLabelText('Search witnesses'), { target: { value: 'Priya' } });
    fireEvent.click(await screen.findByRole('button', { name: /DEMO-1002/ }));

    fireEvent.change(screen.getByLabelText('When it happened'), {
      target: { value: '2026-03-02T08:00' },
    });
    fireEvent.change(screen.getByLabelText('What was the person doing'), {
      target: { value: 'Moving pallets' },
    });
    fireEvent.change(screen.getByLabelText('Equipment or material involved'), {
      target: { value: 'Forklift #4' },
    });
    fireEvent.change(screen.getByLabelText('What happened'), {
      target: { value: 'The load shifted and struck the worker' },
    });
    fireEvent.change(screen.getByLabelText('What was done straight away'), {
      target: { value: 'The area was cordoned off' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));

    await waitFor(() =>
      expect(reportIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          location_id: LOCATION_A,
          subject_person_id: SUBJECT_A,
          witness_person_ids: [WITNESS_A],
        }),
      ),
    );
  }, 30000);

  it('mantiene el aviso y no carga el formulario para inspector', () => {
    useAppSession.mockReturnValue(session('inspector'));

    renderRoute();

    expect(screen.getByText(/Only coordinators and management/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull();
    expect(listSites).not.toHaveBeenCalled();
    expect(listIncidentRoster).not.toHaveBeenCalled();
  });
});

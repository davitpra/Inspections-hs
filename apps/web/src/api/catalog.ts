import {
  createSiteSchema,
  createLocationSchema,
  createOrganizationLocationSchema,
  deactivateSiteSchema,
  deactivateOrganizationLocationSchema,
  locationOrganizationMappingSchema,
  locationSchema,
  organizationLocationSchema,
  siteSchema,
  updateSiteSchema,
  type Location,
  type OrganizationLocation,
  type Site,
} from '@hs/contracts';
import { z } from 'zod';

import { get, send } from './request';

export async function listOrganizationLocations(): Promise<OrganizationLocation[]> {
  return get('/organization-locations', (value) =>
    z.array(organizationLocationSchema).parse(value),
  );
}

export async function listCatalogLocations(): Promise<Location[]> {
  return get('/locations', (value) => z.array(locationSchema).parse(value));
}

/** Alta de una planta. El código se escribe acá y queda permanente en el catálogo. */
export async function createSite(input: { code: string; name: string }): Promise<Site> {
  return send('POST', '/sites', createSiteSchema.parse(input), (value) => siteSchema.parse(value));
}

export async function renameSite(siteId: string, name: string): Promise<Site> {
  return send('PATCH', `/sites/${siteId}`, updateSiteSchema.parse({ name }), (value) =>
    siteSchema.parse(value),
  );
}

export async function deactivateSite(siteId: string): Promise<Site> {
  return send('POST', `/sites/${siteId}/deactivate`, deactivateSiteSchema.parse({}), (value) =>
    siteSchema.parse(value),
  );
}

export async function mapLocation(
  locationId: string,
  organizationLocationId: string | null,
): Promise<Location> {
  return send(
    'PATCH',
    `/locations/${locationId}/organization-location`,
    locationOrganizationMappingSchema.parse({
      organization_location_id: organizationLocationId,
    }),
    (value) => locationSchema.parse(value),
  );
}

/**
 * Alta de una ubicación compartida. Sin planta: es el concepto que las dos comparten.
 *
 * Nace sin mapear en ninguna, así que crear una deja dos huecos nuevos. La pantalla los
 * muestra en vez de esconderlos, que es de lo que se trata el listado.
 */
export async function createOrganizationLocation(input: {
  code: string;
  name: string;
}): Promise<OrganizationLocation> {
  return send('POST', '/organization-locations', createOrganizationLocationSchema.parse(input), (value) =>
    organizationLocationSchema.parse(value),
  );
}

export async function deactivateOrganizationLocation(id: string): Promise<void> {
  await send(
    'PATCH',
    `/organization-locations/${id}`,
    deactivateOrganizationLocationSchema.parse({ deactivated: true }),
    () => undefined,
  );
}

/**
 * Alta de una ubicación física en una planta.
 *
 * La planta va en la RUTA y no en el cuerpo: `createLocationSchema` es un `strictObject`
 * sin `site_id`, y esa ausencia es deliberada (ADR-004). Ver el controller.
 */
export async function createLocation(
  siteId: string,
  input: { code: string; name: string },
): Promise<Location> {
  return send('POST', `/sites/${siteId}/locations`, createLocationSchema.parse(input), (value) =>
    locationSchema.parse(value),
  );
}

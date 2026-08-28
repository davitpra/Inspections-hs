import { sectionsInDocumentOrder } from '@hs/forms';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { listCatalogLocations } from '../../api/catalog';
import { listSites } from '../../api/inspections';
import { getPublishedTemplateVersion } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { GridIcon, InfoIcon } from '../../components/icons';
import { TemplateSectionCard } from '../../components/TemplateSectionCard';
import { canPublishTemplates } from '../../permissions/session';
import { ItemRow } from './ItemRow';
import { sectionAppliesTo, visibilityLabel } from './presentation';
import { VersionHeader } from './VersionHeader';

/**
 * Lee una versión publicada sin convertirla en un formulario.
 *
 * Es online y de solo lectura: el documento llega por el id de la versión, se dibuja con el
 * orden del motor y ningún componente ofrece edición. Una corrección se publica como otra
 * versión, por eso esta pantalla explica que el documento está congelado — y, para el
 * coordinador, ofrece empezarla. Ese botón no vuelve editable nada de lo que se muestra: abre
 * un borrador aparte.
 */
export function PublishedTemplateRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const { versionId } = useParams({ from: '/templates/versions/$versionId' });
  const version = useQuery({
    queryKey: queryKeys.publishedTemplateVersion(versionId),
    queryFn: () => getPublishedTemplateVersion(versionId),
    retry: false,
  });
  const locations = useQuery({
    queryKey: queryKeys.catalogLocations(),
    queryFn: listCatalogLocations,
  });
  const sites = useQuery({
    queryKey: queryKeys.sites(),
    queryFn: listSites,
  });

  if (version.isError) {
    return (
      <>
        <p className="status-card status-card--error">
          <InfoIcon size={20} /> This published template could not be loaded. Reading it needs a
          connection.
        </p>
        <Link className="back-link" to="/templates">
          Back to templates
        </Link>
      </>
    );
  }

  if (version.isPending || !version.data) {
    return (
      <p className="status-card">
        <GridIcon size={20} /> Loading…
      </p>
    );
  }

  const documentOrder = sectionsInDocumentOrder(version.data.document);
  const siteIds = account?.siteScope ?? [];

  return (
    <>
      <VersionHeader version={version.data} canRevise={canPublishTemplates(account)} />
      <div className="published-template__document">
        {documentOrder.map(([section, items], index) => (
          <TemplateSectionCard
            key={section.section_key}
            section={section}
            index={index}
            appliesTo={sectionAppliesTo(
              section,
              locations.data ?? [],
              siteIds,
              (sites.data ?? []).filter((site) => siteIds.includes(site.id)),
            )}
            condition={
              section.visible_when
                ? visibilityLabel(section.visible_when, version.data.document)
                : undefined
            }
          >
            {items.map((item, itemIndex) => (
              <ItemRow
                key={item.item_key}
                item={item}
                index={itemIndex}
                document={version.data.document}
              />
            ))}
          </TemplateSectionCard>
        ))}
      </div>
    </>
  );
}

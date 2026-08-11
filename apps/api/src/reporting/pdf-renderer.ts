import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';

import {
  EMPTY_HEADER_TEMPLATE,
  complianceFooterTemplate,
  renderComplianceHtml,
  type DocumentInput,
} from './report-document';

/**
 * ADR-006 y ADR-008 — EL NAVEGADOR QUE IMPRIME EL DOCUMENTO.
 *
 * ADR-006 eligió Playwright y ADR-008 aceptó por escrito la consecuencia: **la API no
 * puede ir a serverless**, porque necesita Chromium en la imagen. Este archivo es donde
 * esa decisión se cobra, y es también el único de todo el repositorio que sabe que existe
 * un navegador.
 *
 * UN BROWSER POR PROCESO, LEVANTADO PEREZOSAMENTE. Arrancar Chromium cuesta cerca de un
 * segundo, y con dos plantas y un puñado de reportes por año no hace falta ningún pool:
 * hace falta no pagar ese segundo en cada arranque de la API, que es lo que el arranque
 * perezoso evita. La `page` sí es por render y se cierra siempre, para que una que se
 * cuelga no arrastre al navegador ni deje memoria detrás.
 *
 * `setContent` Y NO `goto` A UNA RUTA DEL FRONTEND: un render que navegara a `apps/web`
 * necesitaría una sesión, correría el bundle entero y ataría la generación de evidencia a
 * que el web esté arriba. El HTML se arma en este mismo proceso, que ya tiene los datos.
 *
 * `--no-sandbox` NO ESTÁ, Y ES A PROPÓSITO. Es la bandera que aparece en todos los
 * ejemplos de Docker y la que desactiva el aislamiento del proceso que renderiza HTML con
 * texto escrito por usuarios. La imagen tiene que dar las capacidades que el sandbox
 * necesita; bajar el sandbox para que arranque más fácil es cambiar una dificultad de
 * despliegue por una superficie de ejecución.
 */
@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private browser: Browser | null = null;

  /** Un render que tarda más que esto está colgado, no lento. */
  private readonly timeoutMs = Number(process.env.PDF_RENDER_TIMEOUT_MS ?? 60_000);

  async render(input: DocumentInput): Promise<Buffer> {
    const browser = await this.launched();
    const page = await browser.newPage();

    try {
      page.setDefaultTimeout(this.timeoutMs);

      // `waitUntil: 'load'` alcanza y no hay `networkidle` que esperar: el documento no
      // pide un solo recurso externo. Es la misma propiedad que hace que el render no
      // dependa de la red ni de que ningún otro servicio esté arriba.
      await page.setContent(renderComplianceHtml(input), { waitUntil: 'load' });

      return await page.pdf({
        format: 'Letter',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: EMPTY_HEADER_TEMPLATE,
        footerTemplate: complianceFooterTemplate(input),
        // Los márgenes viven acá y no solo en `@page` porque Chromium ignora el margen
        // inferior de la hoja de estilos cuando imprime un pie: sin este margen, el pie
        // se superpondría con la última fila de la tabla.
        margin: { top: '18mm', bottom: '22mm', left: '12mm', right: '12mm' },
      });
    } finally {
      await page.close();
    }
  }

  private async launched(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;

    this.logger.log('Levantando Chromium para el render de reportes.');
    this.browser = await chromium.launch({ headless: true });

    return this.browser;
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}

import type { OpenAPI } from '@orpc/contract'
import type { Context, HTTPPath, Router } from '@orpc/server'
import type { StandardHandlerInterceptorOptions, StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type { Promisable, Value } from '@orpc/shared'
import type { OpenAPIGeneratorGenerateOptions, OpenAPIGeneratorOptions } from '../openapi-generator'
import { once, stringifyJSON, value } from '@orpc/shared'
import { OpenAPIGenerator } from '../openapi-generator'

export interface OpenAPIReferencePluginOptions<T extends Context> extends OpenAPIGeneratorOptions {
  /**
   * Options to pass to the OpenAPI generate.
   *
   */
  specGenerateOptions?: Value<Promisable<OpenAPIGeneratorGenerateOptions>, [StandardHandlerInterceptorOptions<T>]>

  /**
   * The URL path at which to serve the OpenAPI JSON.
   *
   * @default '/spec.json'
   */
  specPath?: HTTPPath

  /**
   * The URL path at which to serve the API reference UI.
   *
   * @default '/'
   */
  docsPath?: HTTPPath

  /**
   * The document title for the API reference UI.
   *
   * @default 'API Reference'
   */
  docsTitle?: Value<Promisable<string>, [StandardHandlerInterceptorOptions<T>]>

  /**
   * The UI library to use for rendering the API reference.
   *
   * @default 'scalar'
   */
  docsProvider?: 'scalar' | 'swagger'

  /**
   * Arbitrary configuration object for the UI.
   */
  docsConfig?: Value<Promisable<Record<string, unknown>>, [StandardHandlerInterceptorOptions<T>]>

  /**
   * HTML to inject into the <head> of the docs page.
   *
   * @default ''
   */
  docsHead?: Value<Promisable<string>, [StandardHandlerInterceptorOptions<T>]>

  /**
   * URL of the external script bundle for the reference UI.
   *
   * - For Scalar: defaults to 'https://cdn.jsdelivr.net/npm/@scalar/api-reference'
   * - For Swagger UI: defaults to 'https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js'
   */
  docsScriptUrl?: Value<Promisable<string>, [StandardHandlerInterceptorOptions<T>]>

  /**
   * URL of the external CSS bundle for the reference UI (used by Swagger UI).
   *
   * @default 'https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css' (if swagger)
   */
  docsCssUrl?: Value<Promisable<string>, [StandardHandlerInterceptorOptions<T>]>

  /**
   * Override function to generate the full HTML for the docs page.
   */
  renderDocsHtml?: (
    specUrl: string,
    title: string,
    head: string,
    scriptUrl: string,
    config: Record<string, unknown> | undefined,
    spec: OpenAPI.Document,
    docsProvider: 'scalar' | 'swagger',
    cssUrl: string | undefined,
  ) => string
}

export class OpenAPIReferencePlugin<T extends Context> implements StandardHandlerPlugin<T> {
  private readonly generator: OpenAPIGenerator
  private readonly specGenerateOptions: OpenAPIReferencePluginOptions<T>['specGenerateOptions']
  private readonly specPath: Exclude<OpenAPIReferencePluginOptions<T>['specPath'], undefined>
  private readonly docsPath: Exclude<OpenAPIReferencePluginOptions<T>['docsPath'], undefined>
  private readonly docsTitle: Exclude<OpenAPIReferencePluginOptions<T>['docsTitle'], undefined>
  private readonly docsHead: Exclude<OpenAPIReferencePluginOptions<T>['docsHead'], undefined>
  private readonly docsProvider: Exclude<OpenAPIReferencePluginOptions<T>['docsProvider'], undefined>
  private readonly docsScriptUrl: Exclude<OpenAPIReferencePluginOptions<T>['docsScriptUrl'], undefined>
  private readonly docsCssUrl: OpenAPIReferencePluginOptions<T>['docsCssUrl']
  private readonly docsConfig: OpenAPIReferencePluginOptions<T>['docsConfig']
  private readonly renderDocsHtml: Exclude<OpenAPIReferencePluginOptions<T>['renderDocsHtml'], undefined>

  constructor(options: OpenAPIReferencePluginOptions<T> = {}) {
    this.specGenerateOptions = options.specGenerateOptions
    this.docsPath = options.docsPath ?? '/'
    this.docsTitle = options.docsTitle ?? 'API Reference'
    this.docsConfig = options.docsConfig ?? undefined
    this.docsProvider = options.docsProvider ?? 'scalar'

    // Set default script URL based on UI type
    this.docsScriptUrl = options.docsScriptUrl ?? (
      this.docsProvider === 'swagger'
        ? 'https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js'
        : 'https://cdn.jsdelivr.net/npm/@scalar/api-reference'
    )

    // Set CSS URL for Swagger UI
    this.docsCssUrl = options.docsCssUrl ?? (
      this.docsProvider === 'swagger'
        ? 'https://unpkg.com/swagger-ui-dist/swagger-ui.css'
        : undefined
    )

    this.docsHead = options.docsHead ?? ''
    this.specPath = options.specPath ?? '/spec.json'
    this.generator = new OpenAPIGenerator(options)

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    this.renderDocsHtml = options.renderDocsHtml ?? ((specUrl, title, head, scriptUrl, config, spec, docsProvider, cssUrl) => {
      let body: string

      if (docsProvider === 'swagger') {
        const swaggerConfig = {
          dom_id: '#app',
          spec,
          deepLinking: true,
          presets: [
            'SwaggerUIBundle.presets.apis',
            'SwaggerUIBundle.presets.standalone',
          ],
          plugins: [
            'SwaggerUIBundle.plugins.DownloadUrl',
          ],
          ...config,
        }

        body = `
        <body>
          <div id="app"></div>

          <script src="${esc(scriptUrl)}"></script>

          <script>
            window.onload = () => {
              window.ui = SwaggerUIBundle(${stringifyJSON(swaggerConfig).replace(/"(SwaggerUIBundle\.[^"]+)"/g, '$1')})
            }
          </script>
        </body>
        `
      }
      else {
        const scalarConfig = {
          content: stringifyJSON(spec),
          ...config,
        }

        body = `
        <body>
          <div id="app" data-config="${esc(stringifyJSON(scalarConfig))}"></div>

          <script src="${esc(scriptUrl)}"></script>

          <script>
            Scalar.createApiReference('#app', JSON.parse(document.getElementById('app').dataset.config))
          </script>
        </body>
        `
      }

      return `
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>${esc(title)}</title>
            ${cssUrl ? `<link rel="stylesheet" type="text/css" href="${esc(cssUrl)}" />` : ''}
            ${head}
          </head>
          ${body}
        </html>
        `
    })
  }

  init(options: StandardHandlerOptions<T>, router: Router<any, T>): void {
    options.interceptors ??= []

    options.interceptors.push(async (options) => {
      const res = await options.next()

      if (res.matched || options.request.method !== 'GET') {
        return res
      }

      const prefix = options.prefix ?? ''
      const requestPathname = options.request.url.pathname.replace(/\/$/, '') || '/'
      const docsUrl = new URL(`${prefix}${this.docsPath}`.replace(/\/$/, ''), options.request.url.origin)
      const specUrl = new URL(`${prefix}${this.specPath}`.replace(/\/$/, ''), options.request.url.origin)

      const generateSpec = once(async () => {
        return await this.generator.generate(router, {
          servers: [{ url: new URL(prefix, options.request.url.origin).toString() }],
          ...await value(this.specGenerateOptions, options),
        })
      })

      if (requestPathname === specUrl.pathname) {
        const spec = await generateSpec()

        return {
          matched: true,
          response: {
            status: 200,
            headers: {},
            body: new File([stringifyJSON(spec)], 'spec.json', { type: 'application/json' }),
          },
        }
      }

      if (requestPathname === docsUrl.pathname) {
        const html = this.renderDocsHtml(
          specUrl.toString(),
          await value(this.docsTitle, options),
          await value(this.docsHead, options),
          await value(this.docsScriptUrl, options),
          await value(this.docsConfig, options),
          await generateSpec(),
          this.docsProvider,
          await value(this.docsCssUrl, options),
        )

        return {
          matched: true,
          response: {
            status: 200,
            headers: {},
            body: new File([html], 'api-reference.html', { type: 'text/html' }),
          },
        }
      }

      return res
    })
  }
}

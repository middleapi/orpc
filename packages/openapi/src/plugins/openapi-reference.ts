import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptorOptions } from '@orpc/server/standard'
import type { Promisable, Value } from '@orpc/shared'
import type { ApiReferenceConfiguration as ScalarProviderConfig } from '@scalar/api-reference'
import type { StandardUrl } from '@standard-server/core'
import type { SwaggerUIOptions } from 'swagger-ui'
import type { OpenAPIDocument, OpenAPIVersion } from '../types'
import { getTracer, matchesHttpPath, mergeHttpPath, stringifyJSON, toArray, value } from '@orpc/shared'

/**
 * Default UI assets, pinned to exact versions with Subresource Integrity so a new
 * (possibly compromised) publish or a tampered CDN file cannot run on the API origin.
 *
 * Keep each version at or above the matching `@scalar/api-reference` / `swagger-ui` devDependency
 * (enforced by a test) so the `providerConfig` typings match the served UI. To refresh a pin,
 * update its url and regenerate its hash with:
 * `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A` (then prefix with `sha384-`).
 * Also update the pinned urls in the docs (`plugins/openapi-reference.mdx`, `openapi/scalar.mdx`).
 */
const DEFAULT_SCALAR_SCRIPT = {
  url: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0/dist/browser/standalone.js',
  integrity: 'sha384-VXnKAz61Xwc3tbw1P+KKrUP7YbcsSl1Ik4is5UnogJyw9XEYZ5Ay/T1i0zPYtSZH',
}
const DEFAULT_SWAGGER_SCRIPT = {
  url: 'https://unpkg.com/swagger-ui-dist@5.33.2/swagger-ui-bundle.js',
  integrity: 'sha384-gNnUp++d7WqR9OKX4OMoUmV2w0JxEs1uu6NPXgcynGClIX5DOu6ol4Lp+lINyZcJ',
}
const DEFAULT_SWAGGER_CSS = {
  url: 'https://unpkg.com/swagger-ui-dist@5.33.2/swagger-ui.css',
  integrity: 'sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW',
}

export type OpenAPIReferenceHandlerPluginProvider = 'scalar' | 'swagger'

export interface OpenAPIReferenceHandlerPluginScalarConfig extends Partial<ScalarProviderConfig> {
}

export interface OpenAPIReferenceHandlerPluginSwaggerConfig extends Partial<Omit<SwaggerUIOptions, 'dom_id' | 'presets' | 'plugins'>> {
  dom_id?: undefined | never

  /**
   * Paths to global variables holding the presets, resolved in the browser,
   * e.g. `'SwaggerUIBundle.presets.apis'`. Load custom presets through `docsHead`.
   *
   * @default ['SwaggerUIBundle.presets.apis']
   */
  presets?: undefined | string[]

  /**
   * Paths to global variables holding the plugins, resolved in the browser,
   * e.g. `'SwaggerUIBundle.plugins.DownloadUrl'`. Load custom plugins through `docsHead`.
   *
   * @default ['SwaggerUIBundle.plugins.DownloadUrl']
   */
  plugins?: undefined | string[]
}

export interface OpenAPIReferenceHandlerPluginOptions<T extends Context, TProvider extends OpenAPIReferenceHandlerPluginProvider> {
  /**
   * A static or dynamic OpenAPI document to serve.
   * Receives routing interceptor options when provided as a function.
   */
  spec: Value<Promisable<OpenAPIDocument<OpenAPIVersion>>, [StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * Determines whether the docs UI and OpenAPI JSON are allowed to be served for a request.
   * When it resolves to `false`, the request falls through as unmatched,
   * as if the plugin were not installed. Useful for restricting access
   * to authenticated users.
   */
  allow?: Value<Promisable<boolean>, [StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * The URL path at which to serve the OpenAPI JSON.
   *
   * @default '/spec.json'
   */
  specPath?: StandardUrl

  /**
   * The UI provider to use for rendering the API reference.
   *
   * @default 'scalar'
   */
  provider?: TProvider

  /**
   * Provider-specific configuration passed directly to the chosen UI library.
   * Options differ depending on `provider`.
   */
  providerConfig?: undefined | (
    TProvider extends 'swagger'
      ? OpenAPIReferenceHandlerPluginSwaggerConfig
      : OpenAPIReferenceHandlerPluginScalarConfig
  )

  /**
   * URL for the provider's main script bundle.
   * The defaults are version-pinned and loaded with a built-in integrity hash.
   *
   * @default 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0/dist/browser/standalone.js' | 'https://unpkg.com/swagger-ui-dist@5.33.2/swagger-ui-bundle.js'
   */
  providerScriptUrl?: undefined | string

  /**
   * [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
   * hash for the provider's script, e.g. `'sha384-...'`, rendered with `crossorigin="anonymous"`.
   * Overrides the built-in hash of the default script. A custom `providerScriptUrl` never
   * uses the built-in hash, so set this alongside it to keep integrity checking.
   *
   * @default the built-in hash for the default script, otherwise undefined
   */
  providerScriptIntegrity?: undefined | string

  /**
   * URL for the provider's stylesheet.
   * The defaults are version-pinned and loaded with a built-in integrity hash.
   *
   * @default undefined | 'https://unpkg.com/swagger-ui-dist@5.33.2/swagger-ui.css'
   */
  providerCssUrl?: undefined | string

  /**
   * [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
   * hash for the provider's stylesheet, e.g. `'sha384-...'`, rendered with `crossorigin="anonymous"`.
   * Overrides the built-in hash of the default stylesheet. A custom `providerCssUrl` never
   * uses the built-in hash, so set this alongside it to keep integrity checking.
   *
   * @default the built-in hash for the default stylesheet, otherwise undefined
   */
  providerCssIntegrity?: undefined | string

  /**
   * The URL path at which to serve the API reference UI.
   *
   * @default '/'
   */
  docsPath?: StandardUrl

  /**
   * The document title for the API reference UI.
   *
   * @default spec.info.title
   */
  docsTitle?: Value<Promisable<string>, [StandardHandlerRoutingInterceptorOptions<T>]>

  /**
   * Raw HTML to inject into the `<head>` of the API reference page.
   * Useful for custom stylesheets, meta tags, or scripts.
   *
   * @default ''
   */
  docsHead?: Value<Promisable<string>, [StandardHandlerRoutingInterceptorOptions<T>]>
}

/**
 * Serves API reference documentation powered by Scalar or Swagger UI,
 * and exposes the OpenAPI specification as JSON.
 *
 * @remarks
 * **Note**: By default, the API reference UI is served from `/` and the OpenAPI specification from `/spec.json`.
 *
 * @see {@link https://orpc.dev/docs/plugins/openapi-reference | OpenAPI Reference Plugin (Swagger/Scalar)}
 */
export class OpenAPIReferenceHandlerPlugin<
  T extends Context,
  TProvider extends OpenAPIReferenceHandlerPluginProvider,
> implements StandardHandlerPlugin<T> {
  name = '~openapi-reference'

  private readonly spec: OpenAPIReferenceHandlerPluginOptions<T, TProvider>['spec']
  private readonly allow: OpenAPIReferenceHandlerPluginOptions<T, TProvider>['allow']
  private readonly specPath: Exclude<OpenAPIReferenceHandlerPluginOptions<T, TProvider>['specPath'], undefined>
  private readonly provider: Exclude<OpenAPIReferenceHandlerPluginOptions<T, TProvider>['provider'], undefined>
  private readonly providerConfig: OpenAPIReferenceHandlerPluginOptions<T, TProvider>['providerConfig']
  private readonly providerScriptUrl: OpenAPIReferenceHandlerPluginOptions<T, TProvider>['providerScriptUrl']
  private readonly providerScriptIntegrity: OpenAPIReferenceHandlerPluginOptions<T, TProvider>['providerScriptIntegrity']
  private readonly providerCssUrl: OpenAPIReferenceHandlerPluginOptions<T, TProvider>['providerCssUrl']
  private readonly providerCssIntegrity: OpenAPIReferenceHandlerPluginOptions<T, TProvider>['providerCssIntegrity']
  private readonly docsPath: Exclude<OpenAPIReferenceHandlerPluginOptions<T, TProvider>['docsPath'], undefined>
  private readonly docsTitle: OpenAPIReferenceHandlerPluginOptions<T, TProvider>['docsTitle']
  private readonly docsHead: Exclude<OpenAPIReferenceHandlerPluginOptions<T, TProvider>['docsHead'], undefined>

  constructor(options: OpenAPIReferenceHandlerPluginOptions<T, TProvider>) {
    this.spec = options.spec
    this.allow = options.allow
    this.specPath = options.specPath ?? '/spec.json'
    this.provider = options.provider ?? 'scalar' as TProvider
    this.providerConfig = options.providerConfig
    this.providerScriptUrl = options.providerScriptUrl
    this.providerScriptIntegrity = options.providerScriptIntegrity
    this.providerCssUrl = options.providerCssUrl
    this.providerCssIntegrity = options.providerCssIntegrity
    this.docsTitle = options.docsTitle
    this.docsPath = options.docsPath ?? '/'
    this.docsHead = options.docsHead ?? ''
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    return {
      ...options,
      routingInterceptors: [
        // Run after user-provided routing interceptors so they can capture the ui/spec responses
        ...toArray(options.routingInterceptors),
        async ({ next, ...routingInterceptorOptions }) => {
          const result = await next()

          if (result.matched || routingInterceptorOptions.request.method !== 'GET') {
            return result
          }

          const specPath = routingInterceptorOptions.prefix ? mergeHttpPath(routingInterceptorOptions.prefix, this.specPath) : this.specPath
          const docsPath = routingInterceptorOptions.prefix ? mergeHttpPath(routingInterceptorOptions.prefix, this.docsPath) : this.docsPath
          const isSpecPath = matchesHttpPath(routingInterceptorOptions.request.url, specPath)
          const isDocsPath = matchesHttpPath(routingInterceptorOptions.request.url, docsPath)

          if (!isSpecPath && !isDocsPath) {
            return result
          }

          if (await value(this.allow, routingInterceptorOptions) === false) {
            return result
          }

          /**
           * The request url is excluded because span names should have low cardinality,
           * so only the configured paths are used.
           */
          const span = getTracer()?.getActiveSpan()
          const spec = await value(this.spec, routingInterceptorOptions)

          if (isSpecPath) {
            span?.updateName(`${routingInterceptorOptions.request.method} ${specPath} (openapi spec)`)

            const specFile = new File([stringifyJSON(spec)], `${spec.info.title}.json`, {
              type: 'application/json',
            })
            return { matched: true, response: { status: 200, headers: {}, body: specFile } }
          }

          span?.updateName(`${routingInterceptorOptions.request.method} ${docsPath} (${this.provider} ui)`)

          const docsTitle = (await value(this.docsTitle, routingInterceptorOptions)) ?? spec.info.title
          const docsHead = await value(this.docsHead, routingInterceptorOptions)
          let html: string | undefined

          if (this.provider === 'swagger') {
            const script = resolveAsset(this.providerScriptUrl, this.providerScriptIntegrity, DEFAULT_SWAGGER_SCRIPT)
            const css = resolveAsset(this.providerCssUrl, this.providerCssIntegrity, DEFAULT_SWAGGER_CSS)
            const config = {
              dom_id: '#app',
              spec,
              deepLinking: true,
              presets: ['SwaggerUIBundle.presets.apis'],
              plugins: ['SwaggerUIBundle.plugins.DownloadUrl'],
              ...this.providerConfig,
            }

            html = `
            <!doctype html>
            <html>
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>${escapeHtmlEntities(docsTitle)}</title>
                <link rel="stylesheet" type="text/css" href="${escapeHtmlEntities(css.url)}"${integrityAttributes(css.integrity)} />
                ${docsHead}
            </head>
            <body>
                <div id="app"></div>

                <script src="${escapeHtmlEntities(script.url)}"${integrityAttributes(script.integrity)}></script>

                <!-- IMPORTANT: assign to a variable first to prevent ), ( in values breaking the call expression. -->
                <!-- IMPORTANT: escapeJsonForHtml ensures <, > cannot terminate the </script> tag prematurely. -->
                <!-- IMPORTANT: resolve presets/plugins global paths at runtime, never unquote them in the JSON, which also holds the spec. -->
                <script>
                    const swaggerConfig = ${escapeJsonForHtml(config)}

                    window.onload = () => {
                        for (const key of ['presets', 'plugins']) {
                            swaggerConfig[key] &&= swaggerConfig[key].map(path => path.split('.').reduce((value, name) => value?.[name], window))
                        }

                        window.ui = SwaggerUIBundle(swaggerConfig)
                    }
                </script>
            </body>
            </html>
            `
          }

          else {
            const script = resolveAsset(this.providerScriptUrl, this.providerScriptIntegrity, DEFAULT_SCALAR_SCRIPT)
            const config: ScalarProviderConfig = {
              content: stringifyJSON(spec),
              ...this.providerConfig as any,
            }

            html = `
            <!doctype html>
            <html>
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>${escapeHtmlEntities(docsTitle)}</title>
                ${this.providerCssUrl ? `<link rel="stylesheet" type="text/css" href="${escapeHtmlEntities(this.providerCssUrl)}"${integrityAttributes(this.providerCssIntegrity)} />` : ''}
                ${docsHead}
            </head>
            <body>
                <div id="app"></div>

                <script src="${escapeHtmlEntities(script.url)}"${integrityAttributes(script.integrity)}></script>
        
                <!-- IMPORTANT: assign to a variable first to prevent ), ( in values breaking the call expression. -->
                <!-- IMPORTANT: escapeJsonForHtml ensures <, > cannot terminate the </script> tag prematurely. -->
                <script>
                    const scalarConfig = ${escapeJsonForHtml(config)}

                    Scalar.createApiReference('#app', scalarConfig)
                </script>
            </body>
            </html>
            `
          }

          const htmlBlob = new Blob([html], {
            type: 'text/html',
          })

          return {
            matched: true,
            response: {
              status: 200,
              headers: {
                'content-disposition': [], // disable auto-gen header
              },
              body: htmlBlob,
            },
          }
        },
      ],
    }
  }
}

/**
 * Uses the built-in asset unless its url is overridden. A custom url is never paired
 * with the built-in hash, since a mismatch would block the asset.
 */
function resolveAsset(
  url: string | undefined,
  integrity: string | undefined,
  builtIn: { url: string, integrity: string },
): { url: string, integrity: string | undefined } {
  if (url === undefined) {
    return { url: builtIn.url, integrity: integrity ?? builtIn.integrity }
  }

  return { url, integrity }
}

/** Renders the Subresource Integrity attributes of a `<script>`/`<link>` tag, if an integrity is given. */
function integrityAttributes(integrity: string | undefined) {
  return integrity ? ` integrity="${escapeHtmlEntities(integrity)}" crossorigin="anonymous"` : ''
}

/** Escapes a string for safe embedding in an HTML attribute value. */
function escapeHtmlEntities(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Serialises a value to JSON safe for HTML embedding (attribute or <script>).
 * Uses Unicode escapes instead of HTML entities so JSON.parse reconstructs
 * the original values without corruption. Cannot be merged with `esc` —
 * HTML entities inside <script> are not decoded by the JS engine.
 */
function escapeJsonForHtml(obj: object) {
  return stringifyJSON(obj)
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027')
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/\//g, '\\u002F')
}

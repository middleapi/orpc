import type { Tracer, TracingSpan } from '@orpc/shared'
import type { OpenAPIDocument, OpenAPIVersion } from '../types'
import { os } from '@orpc/server'
import { getTracer, setTracer } from '@orpc/shared'
import pkg from '../../package.json'
import { OpenAPIHandler } from '../adapters/fetch'
import { openapi } from '../meta'
import { OpenAPIReferenceHandlerPlugin } from './openapi-reference'

describe('openAPIReferenceHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createSpec(title = 'Example API'): OpenAPIDocument<OpenAPIVersion> {
    return {
      openapi: '3.1.0',
      info: {
        title,
        version: '1.0.0',
      },
      paths: {},
    } as OpenAPIDocument<OpenAPIVersion>
  }

  function getInterceptor(
    plugin: OpenAPIReferenceHandlerPlugin<any, any>,
    options: Record<string, unknown> = {},
  ) {
    const initialized = plugin.init(options as any)
    const interceptor = initialized.routingInterceptors?.at(-1)

    expect(interceptor).toBeDefined()

    return {
      initialized,
      interceptor: interceptor!,
    }
  }

  async function invoke(
    interceptor: ReturnType<typeof getInterceptor>['interceptor'],
    {
      url,
      method = 'GET',
      prefix,
      nextResult = { matched: false as const },
    }: {
      url: `/${string}`
      method?: string
      prefix?: `/${string}`
      nextResult?: any
    },
  ) {
    const next = vi.fn().mockResolvedValue(nextResult)

    const result = await interceptor({
      next,
      context: {},
      prefix,
      request: {
        method,
        url,
        headers: {},
        signal: undefined,
      },
    } as any)

    return { next, result }
  }

  /**
   * Runs the inline swagger script in a fake window holding a fake bundle plus `globals`,
   * and returns the config passed to the bundle.
   */
  function runSwaggerScript(html: string, globals: Record<string, unknown> = {}) {
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!
    const SwaggerUIBundle = Object.assign(vi.fn(), {
      presets: { apis: { preset: 'apis' } },
      plugins: { DownloadUrl: { plugin: 'DownloadUrl' } },
    })
    const window: { onload?: () => void } = { SwaggerUIBundle, ...globals } as any

    // eslint-disable-next-line no-new-func
    new Function('window', 'SwaggerUIBundle', script)(window, SwaggerUIBundle)
    window.onload!()

    expect(SwaggerUIBundle).toHaveBeenCalledTimes(1)

    return { bundle: SwaggerUIBundle, config: SwaggerUIBundle.mock.calls[0]![0] }
  }

  it('preserves existing routing interceptors and returns the matched result from next', async () => {
    const spec = vi.fn().mockResolvedValue(createSpec())
    const existing = vi.fn(({ next }) => next())
    const plugin = new OpenAPIReferenceHandlerPlugin({ spec })
    const { initialized, interceptor } = getInterceptor(plugin, {
      routingInterceptors: [existing],
    })
    const nextResult = {
      matched: true as const,
      response: { status: 204, headers: {}, body: 'handled' },
    }

    expect(initialized.routingInterceptors).toHaveLength(2)
    expect(initialized.routingInterceptors?.[0]).toBe(existing)

    const { next, result } = await invoke(interceptor, {
      url: '/',
      nextResult,
    })

    expect(next).toHaveBeenCalledOnce()
    expect(result).toBe(nextResult)
    expect(spec).not.toHaveBeenCalled()
  })

  it('returns the unmatched result when neither docs nor spec path matches', async () => {
    const spec = vi.fn().mockResolvedValue(createSpec())
    const plugin = new OpenAPIReferenceHandlerPlugin({ spec })
    const { interceptor } = getInterceptor(plugin)
    const nextResult = { matched: false as const }

    const { result } = await invoke(interceptor, {
      url: '/not-found',
      nextResult,
    })

    expect(result).toBe(nextResult)
    expect(spec).not.toHaveBeenCalled()
  })

  it('returns the unmatched result for non-GET requests', async () => {
    const spec = vi.fn().mockResolvedValue(createSpec())
    const plugin = new OpenAPIReferenceHandlerPlugin({ spec })
    const { interceptor } = getInterceptor(plugin)
    const nextResult = { matched: false as const }

    const { result } = await invoke(interceptor, {
      method: 'POST',
      url: '/spec.json',
      nextResult,
    })

    expect(result).toBe(nextResult)
    expect(spec).not.toHaveBeenCalled()
  })

  it('returns the unmatched result when allow resolves to false', async () => {
    const spec = vi.fn().mockResolvedValue(createSpec())
    const allow = vi.fn().mockResolvedValue(false)
    const plugin = new OpenAPIReferenceHandlerPlugin({ spec, allow })
    const { interceptor } = getInterceptor(plugin)
    const nextResult = { matched: false as const }

    for (const url of ['/', '/spec.json'] as const) {
      const { result } = await invoke(interceptor, { url, nextResult })

      expect(result).toBe(nextResult)
    }

    expect(allow).toHaveBeenCalledTimes(2)
    expect(allow).toHaveBeenCalledWith(expect.objectContaining({
      context: {},
      request: expect.objectContaining({ url: '/spec.json' }),
    }))
    expect(spec).not.toHaveBeenCalled()
  })

  it('serves normally when allow resolves to true, without calling it for unrelated paths', async () => {
    const spec = vi.fn().mockResolvedValue(createSpec())
    const allow = vi.fn().mockResolvedValue(true)
    const plugin = new OpenAPIReferenceHandlerPlugin({ spec, allow })
    const { interceptor } = getInterceptor(plugin)

    await invoke(interceptor, { url: '/not-found' })

    expect(allow).not.toHaveBeenCalled()

    const { result } = await invoke(interceptor, { url: '/spec.json' })

    expect(allow).toHaveBeenCalledOnce()
    expect(result.matched).toBe(true)
    expect(result.response?.status).toBe(200)
  })

  it('serves the OpenAPI spec file from a custom spec path with a runtime prefix', async () => {
    const specDocument = createSpec('Generated API')
    const spec = vi.fn().mockResolvedValue(specDocument)
    const plugin = new OpenAPIReferenceHandlerPlugin({
      spec,
      specPath: '/openapi.json',
      docsPath: '/docs',
    })
    const { interceptor } = getInterceptor(plugin)

    const { result } = await invoke(interceptor, {
      url: '/gateway/openapi.json',
      prefix: '/gateway',
    })

    expect(spec).toHaveBeenCalledOnce()
    expect(spec).toHaveBeenCalledWith(expect.objectContaining({
      prefix: '/gateway',
      request: expect.objectContaining({ url: '/gateway/openapi.json' }),
    }))
    expect(result.matched).toBe(true)
    expect(result.response?.status).toBe(200)
    expect(result.response?.headers).toEqual({})
    expect(result.response?.body).toBeInstanceOf(Blob)
    expect((result.response?.body as Blob).type).toBe('application/json')
    await expect((result.response?.body as Blob).text()).resolves.toBe(JSON.stringify(specDocument))
  })

  it('renders scalar docs with default URLs, no stylesheet link, and the spec title fallback', async () => {
    const plugin = new OpenAPIReferenceHandlerPlugin({
      spec: createSpec('Scalar Default Title'),
    })
    const { interceptor } = getInterceptor(plugin)

    const { result } = await invoke(interceptor, {
      url: '/',
    })

    expect(result.matched).toBe(true)
    expect(result.response?.status).toBe(200)
    expect(result.response?.headers).toEqual({
      'content-disposition': [],
    })
    expect((result.response?.body as Blob).type).toBe('text/html')

    const html = await (result.response?.body as Blob).text()

    expect(html).toContain('<title>Scalar Default Title</title>')
    expect(html).toContain('<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0/dist/browser/standalone.js" integrity="sha384-VXnKAz61Xwc3tbw1P+KKrUP7YbcsSl1Ik4is5UnogJyw9XEYZ5Ay/T1i0zPYtSZH" crossorigin="anonymous"></script>')
    expect(html).toContain('Scalar.createApiReference(\'#app\', scalarConfig)')
    expect(html).toContain('const scalarConfig =')
    expect(html).not.toContain('rel="stylesheet"')
    expect(html).not.toContain('undefined')
  })

  it('renders scalar docs with custom title, head, URLs, stylesheet, and escaped config values', async () => {
    const plugin = new OpenAPIReferenceHandlerPlugin({
      spec: createSpec('Scalar Custom'),
      provider: 'scalar',
      docsPath: '/docs',
      docsTitle: async () => 'Scalar & "Docs" <Guide>',
      docsHead: async () => '<meta name="robots" content="noindex" />',
      providerScriptUrl: 'https://cdn.example.com/scalar.js?foo=1&bar=<tag>',
      providerCssUrl: 'https://cdn.example.com/scalar.css?foo=1&bar=<tag>',
      providerConfig: {
        pageTitle: '&\'<>/',
      } as any,
    })
    const { interceptor } = getInterceptor(plugin)

    const { result } = await invoke(interceptor, {
      url: '/gateway/docs',
      prefix: '/gateway',
    })

    const html = await (result.response?.body as File).text()

    expect(html).toContain('<title>Scalar &amp; &quot;Docs&quot; &lt;Guide&gt;</title>')
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).toContain('<link rel="stylesheet" type="text/css" href="https://cdn.example.com/scalar.css?foo=1&amp;bar=&lt;tag&gt;" />')
    expect(html).toContain('<script src="https://cdn.example.com/scalar.js?foo=1&amp;bar=&lt;tag&gt;"></script>')
    expect(html).toContain('pageTitle')
    expect(html).toContain('\\u0026')
    expect(html).toContain('\\u0027')
    expect(html).toContain('\\u003C')
    expect(html).toContain('\\u003E')
    expect(html).toContain('\\u002F')
  })

  it('renders swagger docs with default asset URLs and resolved bundle references', async () => {
    const spec = createSpec('Swagger Default Title')
    const plugin = new OpenAPIReferenceHandlerPlugin({
      spec,
      provider: 'swagger',
    })
    const { interceptor } = getInterceptor(plugin)

    const { result } = await invoke(interceptor, {
      url: '/',
    })

    const html = await (result.response?.body as File).text()

    expect(html).toContain('<title>Swagger Default Title</title>')
    expect(html).toContain('<script src="https://unpkg.com/swagger-ui-dist@5.33.2/swagger-ui-bundle.js" integrity="sha384-gNnUp++d7WqR9OKX4OMoUmV2w0JxEs1uu6NPXgcynGClIX5DOu6ol4Lp+lINyZcJ" crossorigin="anonymous"></script>')
    expect(html).toContain('<link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.33.2/swagger-ui.css" integrity="sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW" crossorigin="anonymous" />')
    expect(html).toContain('const swaggerConfig =')
    expect(html).toContain('window.ui = SwaggerUIBundle(swaggerConfig)')

    const { bundle, config } = runSwaggerScript(html)

    expect(config).toEqual({
      dom_id: '#app',
      spec,
      deepLinking: true,
      presets: [bundle.presets.apis],
      plugins: [bundle.plugins.DownloadUrl],
    })
  })

  it('keeps swagger spec strings that look like bundle references as plain data', async () => {
    const spec = {
      ...createSpec(),
      info: {
        title: 'Example API',
        description: 'Configure with "SwaggerUIBundle.presets',
        version: '1.0.0',
      },
      components: {
        schemas: {
          Preset: { type: 'string', enum: ['SwaggerUIBundle.presets.apis'] },
        },
      },
    } as OpenAPIDocument<OpenAPIVersion>
    const plugin = new OpenAPIReferenceHandlerPlugin({
      spec,
      provider: 'swagger',
    })
    const { interceptor } = getInterceptor(plugin)

    const { result } = await invoke(interceptor, {
      url: '/',
    })

    const html = await (result.response?.body as File).text()
    const { bundle, config } = runSwaggerScript(html)

    expect(config.spec).toEqual(spec)
    expect(config.presets).toEqual([bundle.presets.apis])
  })

  it('renders swagger docs with custom title, head, asset URLs, and escaped provider config', async () => {
    const plugin = new OpenAPIReferenceHandlerPlugin({
      spec: createSpec('Swagger Custom'),
      provider: 'swagger',
      docsPath: '/reference',
      docsTitle: async () => 'Swagger & "Docs" <Guide>',
      docsHead: async () => '<style>body{display:grid}</style>',
      providerScriptUrl: 'https://cdn.example.com/swagger.js?foo=1&bar=<tag>',
      providerCssUrl: 'https://cdn.example.com/swagger.css?foo=1&bar=<tag>',
      providerConfig: {
        tryItOutEnabled: true,
        customOption: '&\'<>/',
        presets: ['SwaggerUIBundle.presets.apis', 'SwaggerUIStandalonePreset'],
        plugins: ['SwaggerUIBundle.plugins.DownloadUrl', 'MyPlugins.logger', 'Missing.plugin'],
      } as any,
    })
    const { interceptor } = getInterceptor(plugin)

    const { result } = await invoke(interceptor, {
      url: '/api/reference?view=full',
      prefix: '/api',
    })

    const html = await (result.response?.body as File).text()

    expect(html).toContain('<title>Swagger &amp; &quot;Docs&quot; &lt;Guide&gt;</title>')
    expect(html).toContain('<style>body{display:grid}</style>')
    expect(html).toContain('<link rel="stylesheet" type="text/css" href="https://cdn.example.com/swagger.css?foo=1&amp;bar=&lt;tag&gt;" />')
    expect(html).toContain('<script src="https://cdn.example.com/swagger.js?foo=1&amp;bar=&lt;tag&gt;"></script>')
    expect(html).toContain('tryItOutEnabled')
    expect(html).toContain('customOption')
    expect(html).toContain('\\u0026')
    expect(html).toContain('\\u0027')
    expect(html).toContain('\\u003C')
    expect(html).toContain('\\u003E')
    expect(html).toContain('\\u002F')

    const SwaggerUIStandalonePreset = { preset: 'standalone' }
    const MyPlugins = { logger: { plugin: 'logger' } }
    const { bundle, config } = runSwaggerScript(html, { SwaggerUIStandalonePreset, MyPlugins })

    expect(config.customOption).toBe('&\'<>/')
    expect(config.presets).toEqual([bundle.presets.apis, SwaggerUIStandalonePreset])
    expect(config.plugins).toEqual([bundle.plugins.DownloadUrl, MyPlugins.logger, undefined])
  })

  it('leaves swagger presets and plugins unset when provider config clears them', async () => {
    const plugin = new OpenAPIReferenceHandlerPlugin({
      spec: createSpec(),
      provider: 'swagger',
      providerConfig: {
        presets: undefined,
        plugins: undefined,
      },
    })
    const { interceptor } = getInterceptor(plugin)

    const { result } = await invoke(interceptor, {
      url: '/',
    })

    const html = await (result.response?.body as File).text()
    const { config } = runSwaggerScript(html)

    expect(config).not.toHaveProperty('presets')
    expect(config).not.toHaveProperty('plugins')
  })
})

describe('openAPIReferenceHandlerPlugin hardening', () => {
  const router = { ping: os.meta(openapi({ method: 'GET', path: '/ping' })).handler(() => 'pong') }
  const spec = { openapi: '3.1.1', info: { title: 'API', version: '1.0.0' }, paths: {} } as any

  function createHandler(options: Record<string, unknown> = {}) {
    return new OpenAPIHandler(router, { plugins: [new OpenAPIReferenceHandlerPlugin({ spec, ...options } as any)] })
  }

  async function render(options: Record<string, unknown> = {}) {
    const { response } = await createHandler(options).handle(new Request('https://api.example.com/'))
    return response!.text()
  }

  /** Every <script>/<link> tag that loads an absolute http(s) URL. */
  function externalTags(html: string) {
    return html.match(/<(?:script|link)\s[^>]*(?:src|href)="https?:[^"]*"[^>]*>/g) ?? []
  }

  /** Compares the first `major.minor.patch` of each string, so a range like `^1.2.3` compares by its lower bound. */
  function compareVersions(a: string, b: string) {
    const [x, y] = [a, b].map(version => version.match(/\d+\.\d+\.\d+/)![0].split('.').map(Number)) as [number[], number[]]
    const index = x.findIndex((part, i) => part !== y[i])
    return index === -1 ? 0 : x[index]! - y[index]!
  }

  /** Records the final name of every ended span, except the internal find_procedure span. */
  function recordSpanNames(onTestFinished: (fn: () => void) => void) {
    const names: string[] = []
    let active: TracingSpan | undefined
    const noopSpan: TracingSpan = { setAttribute() {}, updateName() {}, addEvent() {}, recordException() {}, end() {} }
    const tracer: Tracer = {
      startSpan: () => noopSpan,
      async startActiveSpan(name, _parent, fn) {
        let current = name
        const span: TracingSpan = {
          ...noopSpan,
          updateName(newName) { current = newName },
          end() {
            if (current !== 'find_procedure')
              names.push(current)
          },
        }
        const previous = active
        active = span
        try {
          return await fn(span)
        }
        finally {
          active = previous
        }
      },
      getActiveSpan: () => active,
      withActiveSpan: (_span, fn) => fn(),
    }
    const previous = getTracer()
    setTracer(tracer)
    onTestFinished(() => setTracer(previous))
    return names
  }

  it('names spans after the configured paths, not the raw request url', async ({ onTestFinished }) => {
    const names = recordSpanNames(onTestFinished)
    const handler = createHandler()

    for (const url of [
      'https://example.com/api/spec.json?access_token=SECRET',
      'https://example.com/api/spec.json?r=1',
      'https://example.com/api/spec.json/?r=2',
      'https://example.com/api/?r=3',
      'https://example.com/api?r=4',
    ]) {
      const { matched } = await handler.handle(new Request(url), { prefix: '/api' })
      expect(matched).toBe(true)
    }

    expect(names.join('\n')).not.toContain('SECRET')
    expect(names.join('\n')).not.toContain('?')
    expect(new Set(names)).toEqual(new Set(['GET /api/spec.json (openapi spec)', 'GET /api/ (scalar ui)']))
  })

  it.each(['scalar', 'swagger'] as const)('%s: default assets are version-pinned and carry SRI', async (provider) => {
    const tags = externalTags(await render({ provider }))

    expect(tags).toHaveLength(provider === 'swagger' ? 2 : 1) // Scalar ships its CSS inside the bundle
    for (const tag of tags) {
      expect(tag).toMatch(/@\d+\.\d+\.\d+\//) // exact version, e.g. swagger-ui-dist@5.x.y/
      expect(tag).toMatch(/ integrity="sha(?:256|384|512)-[\w+/]+={0,2}"/)
      expect(tag).toContain(' crossorigin="anonymous"')
    }
  })

  /**
   * Dependabot raises these devDependency ranges on every bump, so this fails until the pinned
   * urls and hashes are refreshed too, keeping the `providerConfig` typings in line with the served UI.
   */
  it.each([
    ['scalar', '@scalar/api-reference'],
    ['swagger', 'swagger-ui'],
  ] as const)('%s: default assets are not older than the %s devDependency', async (provider, dependency) => {
    const tags = externalTags(await render({ provider }))

    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) {
      const pinned = tag.match(/@(\d+\.\d+\.\d+)\//)![1]!

      expect(
        compareVersions(pinned, pkg.devDependencies[dependency]),
        `refresh the pinned ${provider} assets (urls and hashes) in openapi-reference.ts`,
      ).toBeGreaterThanOrEqual(0)
    }
  })

  it('renders user-provided integrity (escaped) only next to user-provided urls', async () => {
    const custom = await render({
      providerScriptUrl: 'https://cdn.example.com/scalar.js',
      providerScriptIntegrity: 'sha384-abc"<x>',
      providerCssUrl: 'https://cdn.example.com/scalar.css',
      providerCssIntegrity: 'sha384-def',
    })
    expect(custom).toContain('<script src="https://cdn.example.com/scalar.js" integrity="sha384-abc&quot;&lt;x&gt;" crossorigin="anonymous"></script>')
    expect(custom).toContain('href="https://cdn.example.com/scalar.css" integrity="sha384-def" crossorigin="anonymous"')

    // a custom url must never be paired with the built-in hash
    const noIntegrity = await render({ providerScriptUrl: 'https://cdn.example.com/scalar.js' })
    expect(noIntegrity).toContain('<script src="https://cdn.example.com/scalar.js"></script>')
  })

  it('lets user-provided integrity override the built-in hash of the default urls', async () => {
    const html = await render({
      provider: 'swagger',
      providerScriptIntegrity: 'sha512-script',
      providerCssIntegrity: 'sha512-css',
    })

    expect(html).toContain('<script src="https://unpkg.com/swagger-ui-dist@5.33.2/swagger-ui-bundle.js" integrity="sha512-script" crossorigin="anonymous"></script>')
    expect(html).toContain('href="https://unpkg.com/swagger-ui-dist@5.33.2/swagger-ui.css" integrity="sha512-css" crossorigin="anonymous"')
  })
})

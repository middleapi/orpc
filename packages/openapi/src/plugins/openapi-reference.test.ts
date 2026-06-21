import type { OpenAPIDocument } from '../types'
import { OpenAPIReferenceHandlerPlugin } from './openapi-reference'

describe('openAPIReferenceHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createSpec(title = 'Example API'): OpenAPIDocument {
    return {
      openapi: '3.1.0',
      info: {
        title,
        version: '1.0.0',
      },
      paths: {},
    } as OpenAPIDocument
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
    expect(html).toContain('https://cdn.jsdelivr.net/npm/@scalar/api-reference')
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

  it('renders swagger docs with default asset URLs and unquoted bundle references', async () => {
    const plugin = new OpenAPIReferenceHandlerPlugin({
      spec: createSpec('Swagger Default Title'),
      provider: 'swagger',
    })
    const { interceptor } = getInterceptor(plugin)

    const { result } = await invoke(interceptor, {
      url: '/',
    })

    const html = await (result.response?.body as File).text()

    expect(html).toContain('<title>Swagger Default Title</title>')
    expect(html).toContain('https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js')
    expect(html).toContain('https://unpkg.com/swagger-ui-dist/swagger-ui.css')
    expect(html).toContain('const swaggerConfig =')
    expect(html).toContain('SwaggerUIBundle.presets.apis')
    expect(html).toContain('SwaggerUIBundle.plugins.DownloadUrl')
    expect(html).not.toContain('"SwaggerUIBundle.presets.apis"')
    expect(html).not.toContain('"SwaggerUIBundle.plugins.DownloadUrl"')
    expect(html).toContain('window.ui = SwaggerUIBundle(swaggerConfig)')
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
        presets: ['SwaggerUIBundle.presets.apis'],
        plugins: ['SwaggerUIBundle.plugins.DownloadUrl'],
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
    expect(html).not.toContain('"SwaggerUIBundle.presets.apis"')
    expect(html).not.toContain('"SwaggerUIBundle.plugins.DownloadUrl"')
  })
})

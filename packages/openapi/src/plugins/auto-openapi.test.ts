import { os } from '@orpc/server'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import { ZodToJsonSchemaConverter } from '../../../zod/src/zod4'
import { OpenAPIHandler } from '../adapters/fetch/openapi-handler'
import { AutoOpenAPIPlugin } from './auto-openapi'

describe('autoOpenAPIPlugin', () => {
  const jsonSchemaConverter = new ZodToJsonSchemaConverter()

  it('should generate OpenAPI spec without output schemas', async () => {
    const router = {
      planet: {
        list: os
          .input(z.object({ limit: z.number().optional() }))
          .handler(async () => [{ id: 1, name: 'Earth' }]),
        find: os
          .input(z.object({ id: z.number() }))
          .handler(async () => ({ id: 1, name: 'Earth' })),
      },
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000/spec.json'))

    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/json')

    const spec = await response!.json()

    // Check that the spec was generated
    expect(spec.openapi).toBe('3.1.1')
    expect(spec.info.title).toBe('Test API')
    expect(spec.paths).toBeDefined()

    // Check that paths were created
    expect(spec.paths['/planet/list']).toBeDefined()
    expect(spec.paths['/planet/find']).toBeDefined()

    // Check that requestBody is generated for POST requests with input schemas
    expect(spec.paths['/planet/list'].post.requestBody).toBeDefined()
    expect(spec.paths['/planet/find'].post.requestBody).toBeDefined()
  })

  it('should auto-generate summary from procedure names', async () => {
    const router = {
      planet: {
        list: os.handler(async () => []),
        find: os.handler(async () => ({})),
        create: os.handler(async () => ({})),
        update: os.handler(async () => ({})),
        delete: os.handler(async () => ({})),
      },
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000/spec.json'))
    const spec = await response!.json()

    // Check auto-generated summaries
    expect(spec.paths['/planet/list'].post.summary).toBe('List Planets')
    expect(spec.paths['/planet/find'].post.summary).toBe('Find Planet')
    expect(spec.paths['/planet/create'].post.summary).toBe('Create Planet')
    expect(spec.paths['/planet/update'].post.summary).toBe('Update Planet')
    expect(spec.paths['/planet/delete'].post.summary).toBe('Delete Planet')
  })

  it('should auto-generate tags from router structure', async () => {
    const router = {
      planet: {
        list: os.handler(async () => []),
      },
      user: {
        profile: {
          get: os.handler(async () => ({})),
        },
      },
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000/spec.json'))
    const spec = await response!.json()

    // Check auto-generated tags
    expect(spec.paths['/planet/list'].post.tags).toEqual(['planet'])
    expect(spec.paths['/user/profile/get'].post.tags).toEqual(['user'])
  })

  it('should respect manually defined metadata', async () => {
    const router = {
      planet: {
        list: os
          .route({
            summary: 'Custom Summary',
            description: 'Custom Description',
            tags: ['custom-tag'],
          })
          .handler(async () => []),
      },
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000/spec.json'))
    const spec = await response!.json()

    // Check that manual metadata is preserved
    expect(spec.paths['/planet/list'].post.summary).toBe('Custom Summary')
    expect(spec.paths['/planet/list'].post.description).toBe('Custom Description')
    expect(spec.paths['/planet/list'].post.tags).toEqual(['custom-tag'])
  })

  it('should respect manually defined output schemas', async () => {
    const router = {
      products: {
        // Manual output schema - should be preserved
        get: os
          .input(z.object({ id: z.string() }))
          .output(
            z.object({
              id: z.string(),
              name: z.string(),
              price: z.number(),
            }),
          )
          .handler(async () => ({
            id: '1',
            name: 'Product',
            price: 100,
          })),

        // No output schema - should use default
        list: os.handler(async () => []),
      },
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000/spec.json'))
    const spec = await response!.json()

    // Manual output schema should be preserved (has properties, not anyOf)
    const getResponseSchema = spec.paths['/products/get'].post.responses['200'].content['application/json'].schema
    expect(getResponseSchema.properties).toBeDefined()
    expect(getResponseSchema.properties.id).toBeDefined()
    expect(getResponseSchema.properties.name).toBeDefined()
    expect(getResponseSchema.properties.price).toBeDefined()

    // Auto-generated default schema should be used (has anyOf)
    const listResponseSchema = spec.paths['/products/list'].post.responses['200'].content['application/json'].schema
    expect(listResponseSchema.anyOf).toBeDefined()
  })

  it('should support mixed manual and auto-generated metadata', async () => {
    const router = {
      api: {
        // Manual summary, auto-generated tags
        endpoint1: os
          .route({
            summary: 'Manual Summary Only',
          })
          .handler(async () => ({})),

        // Manual tags, auto-generated summary
        endpoint2: os
          .route({
            tags: ['manual-tag'],
          })
          .handler(async () => ({})),

        // Complete manual metadata
        endpoint3: os
          .route({
            summary: 'Complete Manual',
            description: 'Manual description',
            tags: ['manual'],
          })
          .output(z.object({ success: z.boolean() }))
          .handler(async () => ({ success: true })),

        // Completely auto-generated
        endpoint4: os.handler(async () => ({})),
      },
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          autoGenerateSummary: true,
          autoGenerateTags: true,
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000/spec.json'))
    const spec = await response!.json()

    // Manual summary preserved, tags auto-generated
    expect(spec.paths['/api/endpoint1'].post.summary).toBe('Manual Summary Only')
    expect(spec.paths['/api/endpoint1'].post.tags).toEqual(['api'])

    // Summary auto-generated, manual tags preserved
    expect(spec.paths['/api/endpoint2'].post.summary).toBe('Endpoint2 Api')
    expect(spec.paths['/api/endpoint2'].post.tags).toEqual(['manual-tag'])

    // All manual metadata preserved
    expect(spec.paths['/api/endpoint3'].post.summary).toBe('Complete Manual')
    expect(spec.paths['/api/endpoint3'].post.description).toBe('Manual description')
    expect(spec.paths['/api/endpoint3'].post.tags).toEqual(['manual'])
    expect(spec.paths['/api/endpoint3'].post.responses['200'].content['application/json'].schema.properties.success).toBeDefined()

    // All auto-generated
    expect(spec.paths['/api/endpoint4'].post.summary).toBe('Endpoint4 Api')
    expect(spec.paths['/api/endpoint4'].post.tags).toEqual(['api'])
  })

  it('should serve docs and spec endpoints', async () => {
    const router = {
      test: os.handler(async () => ({})),
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    // Test docs endpoint
    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('text/html')

    const html = await response!.text()
    expect(html).toContain('<title>API Reference</title>')
    expect(html).toContain('/spec.json')

    // Test spec endpoint
    const { response: specResponse } = await handler.handle(new Request('http://localhost:3000/spec.json'))

    expect(specResponse!.status).toBe(200)
    expect(specResponse!.headers.get('content-type')).toBe('application/json')

    const spec = await specResponse!.json()
    expect(spec.openapi).toBe('3.1.1')
    expect(spec.info.title).toBe('Test API')
    expect(spec.servers).toEqual([{ url: 'http://localhost:3000/' }])

    // Test unmatched endpoint
    expect(
      await handler.handle(new Request('http://localhost:3000/not_found')),
    ).toEqual({ matched: false })
  })

  it('should serve swagger UI when docsProvider is swagger', async () => {
    const router = {
      test: os.handler(async () => ({})),
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          docsProvider: 'swagger',
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('text/html')

    const html = await response!.text()
    expect(html).toContain('<title>API Reference</title>')
    expect(html).toContain('swagger-ui-dist')
    expect(html).toContain('swagger-ui.css')
    expect(html).toContain('SwaggerUIBundle')
    expect(html).not.toContain('Scalar')
  })

  it('should serve scalar UI when docsProvider is scalar (default)', async () => {
    const router = {
      test: os.handler(async () => ({})),
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          docsProvider: 'scalar',
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('text/html')

    const html = await response!.text()
    expect(html).toContain('<title>API Reference</title>')
    expect(html).toContain('@scalar/api-reference')
    expect(html).toContain('id="api-reference"')
    expect(html).toContain('data-url')
    expect(html).not.toContain('SwaggerUIBundle')
  })

  it('should serve docs and spec endpoints with prefix', async () => {
    const router = {
      test: os.handler(async () => ({})),
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    // Test docs endpoint with prefix
    const { response } = await handler.handle(new Request('http://localhost:3000/api'), {
      prefix: '/api',
    })

    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('text/html')
    expect(await response!.text()).toContain('<title>API Reference</title>')

    // Test spec endpoint with prefix
    const { response: specResponse } = await handler.handle(new Request('http://localhost:3000/api/spec.json'), {
      prefix: '/api',
    })

    expect(specResponse!.status).toBe(200)
    expect(specResponse!.headers.get('content-type')).toBe('application/json')
    const spec = await specResponse!.json()
    expect(spec.servers).toEqual([{ url: 'http://localhost:3000/api' }])

    // Test that docs/spec are not served without prefix
    expect(
      await handler.handle(new Request('http://localhost:3000'), {
        prefix: '/api',
      }),
    ).toEqual({ matched: false })

    expect(
      await handler.handle(new Request('http://localhost:3000/spec.json'), {
        prefix: '/api',
      }),
    ).toEqual({ matched: false })

    expect(
      await handler.handle(new Request('http://localhost:3000/api/not_found'), {
        prefix: '/api',
      }),
    ).toEqual({ matched: false })
  })

  it('should not serve docs and spec endpoints if procedure matched', async () => {
    const router = {
      ping: os.route({ method: 'GET', path: '/' }).handler(() => 'pong'),
      pong: os.route({ method: 'GET', path: '/spec.json' }).handler(() => 'ping'),
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    // Existing procedure should override docs endpoint
    const { response } = await handler.handle(new Request('http://localhost:3000'))
    expect(await response!.json()).toEqual('pong')

    // Existing procedure should override spec endpoint
    const { response: specResponse } = await handler.handle(new Request('http://localhost:3000/spec.json'))
    expect(await specResponse!.json()).toEqual('ping')

    // Unmatched endpoint
    const { matched } = await handler.handle(new Request('http://localhost:3000/not_found'))
    expect(matched).toBe(false)
  })

  it('should use docsConfig option', async () => {
    const router = {
      test: os.handler(async () => ({})),
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          docsConfig: async () => ({ foo: '__SOME_VALUE__' }),
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('text/html')
    expect(await response!.text()).toContain('__SOME_VALUE__')
  })

  it('should use custom docsScriptUrl and docsCssUrl for swagger', async () => {
    const customScriptUrl = 'https://custom.example.com/swagger-ui-bundle.js'
    const customCssUrl = 'https://custom.example.com/swagger-ui.css'

    const router = {
      test: os.handler(async () => ({})),
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          docsProvider: 'swagger',
          docsScriptUrl: customScriptUrl,
          docsCssUrl: customCssUrl,
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('text/html')

    const html = await response!.text()
    expect(html).toContain(customScriptUrl)
    expect(html).toContain(customCssUrl)
  })

  it('should work with swagger UI config', async () => {
    const router = {
      test: os.handler(async () => ({})),
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          docsProvider: 'swagger',
          docsConfig: async () => ({
            tryItOutEnabled: true,
            customOption: '__SWAGGER_CONFIG__',
          }),
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000'))

    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('text/html')

    const html = await response!.text()
    expect(html).toContain('swagger-ui-bundle.js')
    expect(html).toContain('swagger-ui.css')
    expect(html).toContain('SwaggerUIBundle')
    expect(html).toContain('__SWAGGER_CONFIG__')
    expect(html).toContain('tryItOutEnabled')
  })

  it('should allow disabling auto-generation features', async () => {
    const router = {
      planet: {
        list: os.handler(async () => []),
      },
    }

    const handler = new OpenAPIHandler(router, {
      plugins: [
        new AutoOpenAPIPlugin({
          schemaConverters: [jsonSchemaConverter],
          autoGenerateSummary: false,
          autoGenerateTags: false,
          specGenerateOptions: {
            info: {
              title: 'Test API',
              version: '1.0.0',
            },
          },
        }),
      ],
    })

    const { response } = await handler.handle(new Request('http://localhost:3000/spec.json'))
    const spec = await response!.json()

    // Check that auto-generation was disabled
    expect(spec.paths['/planet/list'].post.summary).toBeUndefined()
    expect(spec.paths['/planet/list'].post.tags).toBeUndefined()
  })
})

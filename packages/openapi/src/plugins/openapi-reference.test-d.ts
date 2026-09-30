import type { ApiReferenceConfiguration } from '@scalar/api-reference'
import type { SwaggerUIOptions } from 'swagger-ui'
import type { OpenAPIReferenceHandlerPluginOptions, OpenAPIReferenceHandlerPluginScalarConfig, OpenAPIReferenceHandlerPluginSwaggerConfig } from './openapi-reference'
import { OpenAPIReferenceHandlerPlugin } from './openapi-reference'

const spec = { openapi: '3.1.1', info: { title: 'API', version: '1.0.0' } } as const

describe('OpenAPIReferenceHandlerPluginScalarConfig', () => {
  it('is loose but not any by default', () => {
    expectTypeOf<OpenAPIReferenceHandlerPluginScalarConfig>().not.toBeAny()
    expectTypeOf<OpenAPIReferenceHandlerPluginScalarConfig['theme']>().toEqualTypeOf<unknown>()

    const _config: OpenAPIReferenceHandlerPluginScalarConfig = { theme: 'purple', anything: 1 }
  })

  it('type-checks against the provided Scalar configuration', () => {
    expectTypeOf<OpenAPIReferenceHandlerPluginScalarConfig<ApiReferenceConfiguration>>().toEqualTypeOf<Partial<ApiReferenceConfiguration>>()

    const _valid = { theme: 'purple', hideModels: true } satisfies OpenAPIReferenceHandlerPluginScalarConfig<ApiReferenceConfiguration>
    // @ts-expect-error --- unknown option
    const _unknown = { themee: 'purple' } satisfies OpenAPIReferenceHandlerPluginScalarConfig<ApiReferenceConfiguration>
    // @ts-expect-error --- invalid value
    const _invalid = { hideModels: 'yes' } satisfies OpenAPIReferenceHandlerPluginScalarConfig<ApiReferenceConfiguration>
  })
})

describe('OpenAPIReferenceHandlerPluginSwaggerConfig', () => {
  it('is loose but not any by default, except for oRPC-managed options', () => {
    expectTypeOf<OpenAPIReferenceHandlerPluginSwaggerConfig>().not.toBeAny()
    expectTypeOf<OpenAPIReferenceHandlerPluginSwaggerConfig['deepLinking']>().toEqualTypeOf<unknown>()

    const _config: OpenAPIReferenceHandlerPluginSwaggerConfig = { deepLinking: false, presets: ['SwaggerUIBundle.presets.apis'], anything: 1 }
    // @ts-expect-error --- dom_id is managed by oRPC
    const _domId: OpenAPIReferenceHandlerPluginSwaggerConfig = { dom_id: '#app' }
    // @ts-expect-error --- presets are global variable paths
    const _presets: OpenAPIReferenceHandlerPluginSwaggerConfig = { presets: [{}] }
    // @ts-expect-error --- plugins are global variable paths
    const _plugins: OpenAPIReferenceHandlerPluginSwaggerConfig = { plugins: [{}] }
  })

  it('type-checks against the provided Swagger UI options', () => {
    const _valid = {
      deepLinking: false,
      presets: ['SwaggerUIBundle.presets.apis'],
      plugins: ['SwaggerUIBundle.plugins.DownloadUrl'],
    } satisfies OpenAPIReferenceHandlerPluginSwaggerConfig<SwaggerUIOptions>
    // @ts-expect-error --- unknown option
    const _unknown = { deepLinkingg: false } satisfies OpenAPIReferenceHandlerPluginSwaggerConfig<SwaggerUIOptions>
    // @ts-expect-error --- invalid value
    const _invalid = { deepLinking: 'yes' } satisfies OpenAPIReferenceHandlerPluginSwaggerConfig<SwaggerUIOptions>
    // @ts-expect-error --- dom_id is managed by oRPC
    const _domId = { dom_id: '#app' } satisfies OpenAPIReferenceHandlerPluginSwaggerConfig<SwaggerUIOptions>
  })
})

describe('OpenAPIReferenceHandlerPluginOptions', () => {
  it('providerConfig depends on provider', () => {
    expectTypeOf<OpenAPIReferenceHandlerPluginOptions<any, 'scalar'>['providerConfig']>()
      .toEqualTypeOf<undefined | OpenAPIReferenceHandlerPluginScalarConfig>()
    expectTypeOf<OpenAPIReferenceHandlerPluginOptions<any, 'swagger'>['providerConfig']>()
      .toEqualTypeOf<undefined | OpenAPIReferenceHandlerPluginSwaggerConfig>()
  })

  it('accepts provider-typed configs', () => {
    const scalarConfig: OpenAPIReferenceHandlerPluginScalarConfig<ApiReferenceConfiguration> = { theme: 'purple' }
    const swaggerConfig: OpenAPIReferenceHandlerPluginSwaggerConfig<SwaggerUIOptions> = { deepLinking: false }

    const _scalar = new OpenAPIReferenceHandlerPlugin({ spec, providerConfig: scalarConfig })
    const _swagger = new OpenAPIReferenceHandlerPlugin({ spec, provider: 'swagger', providerConfig: swaggerConfig })
    const _swaggerSatisfies = new OpenAPIReferenceHandlerPlugin({
      spec,
      provider: 'swagger',
      providerConfig: { deepLinking: false } satisfies OpenAPIReferenceHandlerPluginSwaggerConfig<SwaggerUIOptions>,
    })

    const _domId = new OpenAPIReferenceHandlerPlugin({
      spec,
      provider: 'swagger',
      // @ts-expect-error --- dom_id is managed by oRPC
      providerConfig: { dom_id: '#app' },
    })
  })
})

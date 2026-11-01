import type { OpenAPIDocument, OpenAPIV3_0, OpenAPIV3_1, OpenAPIV3_2, OpenAPIVersion } from './types'
import { OpenAPIGenerator } from './openapi-generator'

describe('openAPIGenerator.generate', () => {
  const generator = new OpenAPIGenerator()

  it('returns the document type of the requested version', () => {
    expectTypeOf(generator.generate({})).resolves.toEqualTypeOf<OpenAPIV3_2.OpenAPIObject>()
    expectTypeOf(generator.generate({}, {})).resolves.toEqualTypeOf<OpenAPIV3_2.OpenAPIObject>()
    expectTypeOf(generator.generate({}, { version: '3.2.0' })).resolves.toEqualTypeOf<OpenAPIV3_2.OpenAPIObject>()
    expectTypeOf(generator.generate({}, { version: '3.2.7' })).resolves.toEqualTypeOf<OpenAPIV3_2.OpenAPIObject>()
    expectTypeOf(generator.generate({}, { version: '3.1.2' })).resolves.toEqualTypeOf<OpenAPIV3_1.OpenAPIObject>()
    expectTypeOf(generator.generate({}, { version: '3.1.0' })).resolves.toEqualTypeOf<OpenAPIV3_1.OpenAPIObject>()
    expectTypeOf(generator.generate({}, { version: '3.0.4' })).resolves.toEqualTypeOf<OpenAPIV3_0.OpenAPIObject>()
    expectTypeOf(generator.generate({}, { version: '3.0.0' })).resolves.toEqualTypeOf<OpenAPIV3_0.OpenAPIObject>()
  })

  it('widens to every supported document when the version is not a literal', () => {
    const version = '3.1.2' as OpenAPIVersion

    expectTypeOf(generator.generate({}, { version })).resolves.toEqualTypeOf<OpenAPIDocument<OpenAPIVersion>>()
    expectTypeOf(generator.generate({}, { version: undefined })).resolves.toEqualTypeOf<OpenAPIDocument<OpenAPIVersion>>()
  })

  it('rejects unsupported versions and the openapi field in base', () => {
    // @ts-expect-error unsupported version
    generator.generate({}, { version: '4.0.0' })
    // @ts-expect-error the patch segment is required
    generator.generate({}, { version: '3.2' })
    // @ts-expect-error the openapi field is derived from version
    generator.generate({}, { base: { openapi: '3.2.0' } })
  })

  it('requires errorResponseBodySchema to return a schema or null', () => {
    generator.generate({}, { errorResponseBodySchema: () => null })
    generator.generate({}, { errorResponseBodySchema: (_errors, _status, defaultSchema) => defaultSchema() })
    // @ts-expect-error undefined is not allowed, return null for an empty body
    generator.generate({}, { errorResponseBodySchema: () => undefined })
    // @ts-expect-error a missing return is not allowed
    generator.generate({}, { errorResponseBodySchema: (_errors, status) => {
      if (status === 404) {
        return null
      }
    } })
  })
})

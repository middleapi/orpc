import type { AnySchema } from '@orpc/contract'
import type {
  OpenAPIMeta,
  OpenAPIParameterStyleResolver,
  OpenAPIParameterStyles,
  OpenAPIParamsStyle,
  OpenAPIQueryStyle,
} from '.'

describe('OpenAPIMeta parameter styles', () => {
  it('accepts resolvers with the parameter name and input schema stack', () => {
    const paramsStyles: OpenAPIMeta['paramsStyles'] = (name, inputSchemas) => {
      expectTypeOf(name).toEqualTypeOf<string>()
      expectTypeOf(inputSchemas).toEqualTypeOf<readonly AnySchema[] | undefined>()

      return name === 'ids' ? 'comma-delimited-array' : undefined
    }
    const queryStyles: OpenAPIMeta['queryStyles'] = (name, inputSchemas) => {
      expectTypeOf(name).toEqualTypeOf<string>()
      expectTypeOf(inputSchemas).toEqualTypeOf<readonly AnySchema[] | undefined>()

      return name === 'filter' ? 'json' : undefined
    }

    expectTypeOf(paramsStyles).toMatchTypeOf<NonNullable<OpenAPIMeta['paramsStyles']>>()
    expectTypeOf(queryStyles).toMatchTypeOf<NonNullable<OpenAPIMeta['queryStyles']>>()
  })

  it('exports reusable style and resolver types', () => {
    const paramsResolver: OpenAPIParameterStyleResolver<OpenAPIParamsStyle> = name => (
      name === 'ids' ? 'comma-delimited-array' : undefined
    )
    const queryStyles: OpenAPIParameterStyles<OpenAPIQueryStyle> = {
      filter: 'json',
    }

    expectTypeOf(paramsResolver).toMatchTypeOf<NonNullable<OpenAPIMeta['paramsStyles']>>()
    expectTypeOf(queryStyles).toMatchTypeOf<NonNullable<OpenAPIMeta['queryStyles']>>()
  })
})

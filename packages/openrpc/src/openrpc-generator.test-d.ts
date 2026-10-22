import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure } from '@orpc/server'
import type { OpenRPCGeneratorError, OpenRPCGeneratorGenerateOptions, OpenRPCVersion } from './openrpc-generator'
import type { OpenRPCDocument } from './types'
import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { z } from 'zod'
import { OpenRPCGenerator } from './openrpc-generator'

describe('openRPCGenerator', () => {
  const generator = new OpenRPCGenerator({ converters: [new ZodToJsonSchemaConverter()] })

  it('accepts routers and contracts and returns an OpenRPC document', () => {
    const router = { ping: os.input(z.object({ a: z.string() })).handler(() => 'pong'), nested: { lazy: os.lazy(() => Promise.resolve({ default: { a: os.handler(() => 1) } })) } }
    const contract = { ping: oc.input(z.object({ a: z.string() })).output(z.string()) }

    expectTypeOf(generator.generate(router)).toEqualTypeOf<Promise<OpenRPCDocument>>()
    expectTypeOf(generator.generate(contract)).toEqualTypeOf<Promise<OpenRPCDocument>>()
    expectTypeOf(generator.generate(contract, {})).toEqualTypeOf<Promise<OpenRPCDocument>>()

    // @ts-expect-error not a router
    generator.generate(1)
  })

  it('types the generate options', () => {
    generator.generate({}, {
      version: '1.4.1',
      base: {
        info: { title: 'Planets', version: '1.0.0' },
        servers: [{ url: 'https://example.com/rpc' }],
        methods: [{ name: 'legacy', params: [] }],
        components: { schemas: { Planet: { type: 'object' } } },
      },
      filter: (procedure, path) => {
        expectTypeOf(procedure).toEqualTypeOf<AnyProcedureContract | AnyProcedure>()
        expectTypeOf(path).toEqualTypeOf<string[]>()
        return true
      },
      errorCodeMap: { NOT_FOUND: -32004, OUT_OF_STOCK: 1001 },
      customComponentName: defName => defName.toUpperCase(),
    })

    generator.generate({}, { filter: false, customComponentName: () => undefined })

    // @ts-expect-error the openrpc field is derived from version
    generator.generate({}, { base: { openrpc: '1.3.2' } })
    // @ts-expect-error error codes are numbers
    generator.generate({}, { errorCodeMap: { NOT_FOUND: 'x' } })
  })

  it('accepts OpenRPC 1.3 and 1.4 versions only', () => {
    expectTypeOf<'1.3.2'>().toExtend<OpenRPCVersion>()
    expectTypeOf<'1.3.0'>().toExtend<OpenRPCVersion>()
    expectTypeOf<'1.4.1'>().toExtend<OpenRPCVersion>()
    expectTypeOf<OpenRPCGeneratorGenerateOptions['version']>().toEqualTypeOf<OpenRPCVersion | undefined>()

    // @ts-expect-error unsupported version
    generator.generate({}, { version: '1.2.6' })
    // @ts-expect-error unsupported version
    generator.generate({}, { version: '2.0.0' })
    // @ts-expect-error the patch segment is required
    generator.generate({}, { version: '1.3' })
  })

  it('types the generator options', () => {
    // eslint-disable-next-line no-new
    new OpenRPCGenerator()
    // eslint-disable-next-line no-new
    new OpenRPCGenerator({ serializer: { serializeJson: () => ({ json: {} }) } as any })

    // @ts-expect-error converters must be an array
    // eslint-disable-next-line no-new
    new OpenRPCGenerator({ converters: new ZodToJsonSchemaConverter() })
  })

  it('openRPCGeneratorError is a TypeError', () => {
    expectTypeOf<OpenRPCGeneratorError>().toExtend<TypeError>()
  })
})

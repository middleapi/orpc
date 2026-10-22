import type {
  OpenRPCComponentsObject,
  OpenRPCContentDescriptorObject,
  OpenRPCDocument,
  OpenRPCErrorObject,
  OpenRPCExampleObject,
  OpenRPCExamplePairingObject,
  OpenRPCMethodObject,
  OpenRPCReferenceObject,
  OpenRPCTagObject,
} from './types'

describe('OpenRPCDocument', () => {
  it('describes a complete document', () => {
    const doc: OpenRPCDocument = {
      'openrpc': '1.3.2',
      'info': {
        'title': 'Planets',
        'version': '1.0.0',
        'contact': { 'name': 'oRPC', 'x-contact': true },
        'license': { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
        'x-info': 1,
      },
      'servers': [{ url: 'https://example.com/rpc', variables: { region: { default: 'eu', enum: ['eu', 'us'] } } }],
      'methods': [
        {
          'name': 'planet.find',
          'params': [{ name: 'id', schema: { type: 'integer' }, required: true }],
          'result': { name: 'result', schema: { $ref: '#/components/schemas/Planet' } },
          'paramStructure': 'by-name',
          'tags': [{ name: 'planet' }, { $ref: '#/components/tags/planet' }],
          'errors': [{ code: -32004, message: 'Not Found', data: { code: 'NOT_FOUND', defined: true } }],
          'examples': [{ name: 'earth', params: [{ name: 'id', value: 1 }], result: { name: 'result', value: { name: 'Earth' } } }],
          'x-method': 'extension',
        },
        { $ref: '#/components/methods/ping' },
      ],
      'components': {
        schemas: { Planet: { type: 'object', properties: { name: { type: 'string' } } } },
        tags: { planet: { name: 'planet' } },
      },
      'externalDocs': { url: 'https://orpc.dev' },
      'x-document': [1, 2, 3],
    }

    expectTypeOf(doc.methods).toEqualTypeOf<(OpenRPCMethodObject | OpenRPCReferenceObject)[]>()
  })

  it('requires openrpc, info, and methods', () => {
    // @ts-expect-error openrpc is required
    const _a: OpenRPCDocument = { info: { title: 't', version: '1' }, methods: [] }
    // @ts-expect-error info is required
    const _b: OpenRPCDocument = { openrpc: '1.3.2', methods: [] }
    // @ts-expect-error methods is required
    const _c: OpenRPCDocument = { openrpc: '1.3.2', info: { title: 't', version: '1' } }
  })

  it('rejects unknown non-extension fields', () => {
    // @ts-expect-error unknown field
    const _doc: OpenRPCDocument = { openrpc: '1.3.2', info: { title: 't', version: '1' }, methods: [], unknown: true }
  })
})

describe('specification extensions', () => {
  it('are allowed where the meta-schema allows them', () => {
    expectTypeOf<{ 'name': 'a', 'params': [], 'x-a': 1 }>().toExtend<OpenRPCMethodObject>()
    expectTypeOf<{ 'name': 'a', 'schema': true, 'x-a': 1 }>().toExtend<OpenRPCContentDescriptorObject>()
    expectTypeOf<{ 'name': 'a', 'x-a': 1 }>().toExtend<OpenRPCTagObject>()
    expectTypeOf<{ 'name': 'a', 'value': 1, 'x-a': 1 }>().toExtend<OpenRPCExampleObject>()
    expectTypeOf<{ 'name': 'a', 'params': [], 'x-a': 1 }>().toExtend<OpenRPCExamplePairingObject>()
    expectTypeOf<{ 'x-a': 1 }>().toExtend<OpenRPCComponentsObject>()
  })

  it('are rejected on error and reference objects', () => {
    // @ts-expect-error additionalProperties: false in the meta-schema
    const _error: OpenRPCErrorObject = { 'code': 1, 'message': 'x', 'x-a': 1 }
    // @ts-expect-error additionalProperties: false in the meta-schema
    const _reference: OpenRPCReferenceObject = { '$ref': '#/components/schemas/A', 'x-a': 1 }
  })

  it('keep their values typed as unknown', () => {
    expectTypeOf<OpenRPCMethodObject['x-anything']>().toEqualTypeOf<unknown>()
  })
})

describe('OpenRPCMethodObject', () => {
  it('limits paramStructure', () => {
    expectTypeOf<OpenRPCMethodObject['paramStructure']>().toEqualTypeOf<'by-name' | 'by-position' | 'either' | undefined>()

    // @ts-expect-error unknown param structure
    const _method: OpenRPCMethodObject = { name: 'a', params: [], paramStructure: 'positional' }
  })

  it('has no summary on tags', () => {
    // @ts-expect-error the meta-schema has no tag summary
    const _tag: OpenRPCTagObject = { name: 'a', summary: 'x' }
  })
})

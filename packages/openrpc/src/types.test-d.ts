import type { OpenRPCDocument } from './types'

describe('OpenRPCDocument', () => {
  it('allows x- extensions only', () => {
    expectTypeOf({
      'openrpc': '1.3.2',
      'info': { 'title': 'Planets', 'version': '1.0.0', 'x-logo': { url: 'https://example.com/logo.png' } },
      'methods': [{ 'name': 'find', 'params': [{ 'name': 'id', 'schema': {}, 'x-hint': 1 }], 'x-rate-limit': 100 }],
      'x-generated-at': '2020-01-01',
    } satisfies OpenRPCDocument).toExtend<OpenRPCDocument>()

    // @ts-expect-error unknown fields must be prefixed with x-
    expectTypeOf({ openrpc: '1.3.2', info: { title: 'Planets', version: '1.0.0' }, methods: [], custom: true } satisfies OpenRPCDocument)
  })
})

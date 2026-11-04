import { oc } from '@orpc/contract'
import * as arktype from 'arktype'
import z from 'zod'
import { OpenRPCGenerator } from '../../src'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../__shared__/schema'

describe('openRPCGenerator e2e: schema library agnosticism', () => {
  const generator = new OpenRPCGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

  it('generates the same method shape from zod, arktype, and plain JSON schemas', async () => {
    const doc = await generator.generate({
      withZod: oc
        .input(z.object({ name: z.string(), radius: z.number().optional() }))
        .output(z.object({ id: z.string() })),
      withArktype: oc
        .input(arktype.type({ 'name': 'string', 'radius?': 'number' }))
        .output(arktype.type({ id: 'string' })),
      withJsonSchema: oc
        .input(testSchema({ type: 'object', properties: { name: { type: 'string' }, radius: { type: 'number' } }, required: ['name'] }))
        .output(testSchema({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] })),
    })

    expect(doc.methods.map(method => 'name' in method && method.name)).toEqual(['withZod', 'withArktype', 'withJsonSchema'])

    for (const method of doc.methods) {
      expect(method).toEqual({
        name: expect.any(String),
        paramStructure: 'by-name',
        params: [
          { name: 'name', required: true, schema: { type: 'string' } },
          { name: 'radius', schema: { type: 'number' } },
        ],
        result: {
          name: 'result',
          schema: expect.objectContaining({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }),
        },
      })
    }
  })

  it('relies on each library to tell optional inputs and outputs apart', async () => {
    const doc = await generator.generate({
      withZod: oc.input(z.array(z.string()).optional()).output(z.string().optional()),
      withJsonSchema: oc
        .input(testSchema({ type: 'array', items: { type: 'string' } }, { optional: true }))
        .output(testSchema({ type: 'string' }, { optional: true })),
    })

    for (const method of doc.methods) {
      expect(method).toEqual({
        name: expect.any(String),
        paramStructure: 'by-position',
        params: [{ name: 'input', schema: { type: 'array', items: { type: 'string' } } }],
        result: { name: 'result', schema: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      })
    }
  })

  it('supports plain JSON schemas with $defs, hoisting them into components', async () => {
    const doc = await generator.generate({
      createPlanet: oc.input(testSchema({
        type: 'object',
        properties: { planet: { $ref: '#/$defs/Planet' } },
        required: ['planet'],
        $defs: {
          Planet: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
      })),
    })

    expect(doc).toEqual({
      openrpc: '1.3.2',
      info: { title: 'API Reference', version: '0.0.0' },
      methods: [{
        name: 'createPlanet',
        paramStructure: 'by-name',
        params: [{ name: 'planet', required: true, schema: { $ref: '#/components/schemas/Planet' } }],
        result: { name: 'result', schema: {} },
      }],
      components: {
        schemas: {
          Planet: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
      },
    })
  })
})

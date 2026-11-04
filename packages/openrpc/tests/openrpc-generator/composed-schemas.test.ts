import type { JsonSchema } from '@orpc/json-schema'
import { oc } from '@orpc/contract'
import z from 'zod'
import { OpenRPCGenerator } from '../../src'
import { testSchema, testSchemaConverter, zodJsonSchemaConverter } from '../__shared__/schema'

describe('openRPCGenerator e2e: composed schemas', () => {
  const generator = new OpenRPCGenerator({ converters: [testSchemaConverter, zodJsonSchemaConverter] })

  it('documents polymorphic payloads as a single by-position param and a polymorphic result', async () => {
    const doc = await generator.generate({
      ingestEvent: oc
        .input(z.discriminatedUnion('type', [
          z.object({ type: z.literal('click'), x: z.number() }),
          z.object({ type: z.literal('view'), duration: z.number() }),
        ]))
        .output(z.union([
          z.object({ accepted: z.literal(true) }),
          z.object({ accepted: z.literal(false), reason: z.string() }),
        ])),
    })

    expect(doc.methods).toEqual([{
      name: 'ingestEvent',
      paramStructure: 'by-position',
      params: [{
        name: 'input',
        required: true,
        schema: {
          oneOf: [
            expect.objectContaining({ properties: { type: { type: 'string', const: 'click' }, x: { type: 'number' } } }),
            expect.objectContaining({ properties: { type: { type: 'string', const: 'view' }, duration: { type: 'number' } } }),
          ],
        },
      }],
      result: {
        name: 'result',
        schema: {
          anyOf: [
            expect.objectContaining({ required: ['accepted'] }),
            expect.objectContaining({ required: ['accepted', 'reason'] }),
          ],
        },
      },
    }])
  })

  it('documents intersection inputs as by-name params and intersection outputs as a merged object', async () => {
    const doc = await generator.generate({
      searchPlanets: oc
        .input(z.intersection(
          z.looseObject({ search: z.string() }),
          z.looseObject({ page: z.number().optional() }),
        ))
        .output(z.intersection(
          z.looseObject({ items: z.array(z.string()) }),
          z.looseObject({ total: z.number() }),
        )),
    })

    expect(doc.methods).toEqual([{
      name: 'searchPlanets',
      paramStructure: 'by-name',
      params: [
        { name: 'search', required: true, schema: { type: 'string' } },
        { name: 'page', schema: { type: 'number' } },
      ],
      result: {
        name: 'result',
        schema: expect.objectContaining({ type: 'object', required: ['items', 'total'] }),
      },
    }])
  })

  it('keeps an object input by-position when its root composition cannot be split into params', async () => {
    const FindPlanetInput: JsonSchema = {
      type: 'object',
      properties: { id: { type: 'number' }, slug: { type: 'string' } },
      anyOf: [{ required: ['id'] }, { required: ['slug'] }],
    }

    const doc = await generator.generate({
      findPlanet: oc.input(testSchema(FindPlanetInput)),
      // the root constraint lives in a property, so splitting keeps it
      findMoon: oc.input(testSchema({ type: 'object', properties: { planet: FindPlanetInput }, required: ['planet'] })),
    })

    expect(doc.methods).toEqual([
      {
        name: 'findPlanet',
        paramStructure: 'by-position',
        params: [{ name: 'input', required: true, schema: FindPlanetInput }],
        result: { name: 'result', schema: {} },
      },
      {
        name: 'findMoon',
        paramStructure: 'by-name',
        params: [{ name: 'planet', required: true, schema: FindPlanetInput }],
        result: { name: 'result', schema: {} },
      },
    ])
  })
})

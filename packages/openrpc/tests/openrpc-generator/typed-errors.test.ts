import { oc } from '@orpc/contract'
import z from 'zod'
import { OpenRPCGenerator } from '../../src'
import { zodJsonSchemaConverter } from '../__shared__/schema'

describe('openRPCGenerator e2e: typed errors', () => {
  const generator = new OpenRPCGenerator({ converters: [zodJsonSchemaConverter] })

  const router = {
    createPlanet: oc
      .errors({
        CONFLICT: {
          message: 'Planet already exists',
          data: z.object({ existingId: z.string() }).meta({ id: 'ConflictData' }),
        },
        UNPROCESSABLE_CONTENT: {},
        BAD_REQUEST: {},
      })
      .input(z.object({ name: z.string() })),
    getPlanet: oc
      .errors({ NOT_FOUND: {} })
      .input(z.object({ id: z.string() })),
  }

  it('documents each error with its JSON-RPC code, message, and the oRPC code carried in data', async () => {
    const doc = await generator.generate(router)

    expect(doc.methods).toEqual([
      expect.objectContaining({
        name: 'createPlanet',
        errors: [
          { code: -32009, message: 'Planet already exists', data: { code: 'CONFLICT', defined: true } },
          { code: -32022, message: 'Unprocessable Content', data: { code: 'UNPROCESSABLE_CONTENT', defined: true } },
          // input validation errors share the "Invalid params" code
          { code: -32602, message: 'Bad Request', data: { code: 'BAD_REQUEST', defined: true } },
        ],
      }),
      expect.objectContaining({
        name: 'getPlanet',
        errors: [{ code: -32004, message: 'Not Found', data: { code: 'NOT_FOUND', defined: true } }],
      }),
    ])

    // error data schemas are not part of the OpenRPC error object
    expect(doc.components).toBeUndefined()
  })

  it('documents errors defined on a contract router for every procedure under it', async () => {
    const doc = await generator.generate(
      oc.errors({ UNAUTHORIZED: {} }).router({
        planet: {
          find: oc.errors({ NOT_FOUND: {} }),
          list: oc,
        },
      }),
    )

    expect(doc.methods).toEqual([
      expect.objectContaining({
        name: 'planet.find',
        errors: [
          { code: -32001, message: 'Unauthorized', data: { code: 'UNAUTHORIZED', defined: true } },
          { code: -32004, message: 'Not Found', data: { code: 'NOT_FOUND', defined: true } },
        ],
      }),
      expect.objectContaining({
        name: 'planet.list',
        errors: [{ code: -32001, message: 'Unauthorized', data: { code: 'UNAUTHORIZED', defined: true } }],
      }),
    ])
  })
})

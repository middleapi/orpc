import type { DrainContext } from 'evlog'
import { ORPCError, os, ValidationError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { EvlogHandlerPlugin } from './handler-plugin'

const SECRET = 'hunter2-SUPER-SECRET'

describe('evlogHandlerPlugin validation errors', () => {
  let printed: string[]

  beforeEach(() => {
    printed = []

    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '))
      })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function call(handler: RPCHandler<any>, path: string, json: unknown) {
    const { response } = await handler.handle(new Request(`http://localhost/rpc/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json }),
    }), { prefix: '/rpc' })

    return response
  }

  it('does not log raw input when input validation fails', async () => {
    const events: DrainContext['event'][] = []
    const router = {
      changePassword: os
        .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(12) }))
        .handler(() => 'ok'),
    }

    const handler = new RPCHandler(router, {
      plugins: [new EvlogHandlerPlugin({ drain: ({ event }) => { events.push(event) } })],
    })

    const response = await call(handler, 'changePassword', { currentPassword: SECRET, newPassword: 'short' })

    expect(response?.status).toBe(400)
    await vi.waitFor(() => expect(events).toHaveLength(1))

    expect(JSON.stringify(events)).not.toContain(SECRET)
    expect(printed.join('\n')).not.toContain(SECRET)

    expect(events[0]).toMatchObject({
      level: 'warn',
      status: 400,
      error: {
        name: 'ORPCError',
        message: 'Input validation failed',
        code: 'BAD_REQUEST',
        defined: false,
        issues: [{ message: expect.any(String), path: ['newPassword'] }],
      },
    })
    expect(events[0]!.error).not.toHaveProperty('data')
    expect(events[0]!.error).not.toHaveProperty('cause')
  })

  it('does not log raw output when output validation fails', async () => {
    const events: DrainContext['event'][] = []
    const router = {
      me: os
        .output(z.object({ id: z.string() }))
        .handler(() => ({ id: 1, passwordHash: SECRET }) as any),
    }

    const handler = new RPCHandler(router, {
      plugins: [new EvlogHandlerPlugin({ drain: ({ event }) => { events.push(event) } })],
    })

    const response = await call(handler, 'me', undefined)

    expect(response?.status).toBe(500)
    await vi.waitFor(() => expect(events).toHaveLength(1))

    expect(JSON.stringify(events)).not.toContain(SECRET)
    expect(printed.join('\n')).not.toContain(SECRET)

    expect(events[0]).toMatchObject({
      level: 'error',
      status: 500,
      error: {
        name: 'ORPCError',
        message: 'Output validation failed',
        code: 'INTERNAL_SERVER_ERROR',
        cause: {
          name: 'ValidationError',
          message: 'Output validation failed',
          issues: [{ message: expect.any(String), path: ['id'] }],
        },
      },
    })
    expect((events[0]!.error as any).cause).not.toHaveProperty('invalidData')
  })

  it('does not log raw input when a custom validation error wraps the original one', async () => {
    const events: DrainContext['event'][] = []
    const router = {
      changePassword: os
        .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(12) }))
        .handler(() => 'ok'),
    }

    const handler = new RPCHandler(router, {
      plugins: [new EvlogHandlerPlugin({ drain: ({ event }) => { events.push(event) } })],
      clientInterceptors: [
        async ({ next }) => {
          try {
            return await next()
          }
          catch (error) {
            if (error instanceof ORPCError && error.cause instanceof ValidationError) {
              throw new ORPCError('INPUT_VALIDATION_FAILED', {
                data: { fields: error.cause.issues.map(issue => ({ ...issue })) },
                cause: error,
              })
            }

            throw error
          }
        },
      ],
    })

    await call(handler, 'changePassword', { currentPassword: SECRET, newPassword: 'short' })

    await vi.waitFor(() => expect(events).toHaveLength(1))

    expect(JSON.stringify(events)).not.toContain(SECRET)
    expect(printed.join('\n')).not.toContain(SECRET)

    expect(events[0]).toMatchObject({
      error: {
        name: 'ORPCError',
        code: 'INPUT_VALIDATION_FAILED',
        issues: [{ message: expect.any(String), path: ['newPassword'] }],
      },
    })
  })
})

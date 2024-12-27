import { ContractProcedure } from '@orpc/contract'
import { ORPC_HANDLER_HEADER, ORPC_HANDLER_VALUE } from '@orpc/shared'
import { describe, expect, it, vi } from 'vitest'
import { lazy } from '../lazy'
import { Procedure } from '../procedure'
import { createProcedureClient } from '../procedure-client'
import { ORPCHandler } from './orpc-handler'

vi.mock('../procedure-client', () => ({
  createProcedureClient: vi.fn(() => vi.fn()),
}))

describe('oRPCHandler', () => {
  const ping = new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    handler: vi.fn(),
  })
  const pong = new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    handler: vi.fn(),
  })

  const router = {
    ping: lazy(() => Promise.resolve({ default: ping })),
    pong,
    nested: lazy(() => Promise.resolve({
      default: {
        ping,
        pong: lazy(() => Promise.resolve({ default: pong })),
      },
    })),
  }

  it('should return a 404 response if no matching procedure is found', async () => {
    const handler = new ORPCHandler(router)

    const mockRequest = new Request('https://example.com/not_found', {
      headers: new Headers({ }),
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(404)

    const body = await response?.text()
    expect(body).toContain('Not found')
  })

  it('should return a 200 response with serialized output if procedure is resolved successfully', async () => {
    const handler = new ORPCHandler(router)

    const caller = vi.fn().mockReturnValueOnce('__mocked__')
    vi.mocked(createProcedureClient).mockReturnValue(caller)

    const mockRequest = new Request('https://example.com/ping', {
      headers: new Headers({ }),
      method: 'POST',
      body: JSON.stringify({ data: { value: '123' }, meta: [] }),
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(200)

    const body = await response?.json()
    expect(body).toEqual({ data: '__mocked__', meta: [] })

    expect(caller).toBeCalledTimes(1)
    expect(caller).toBeCalledWith({ value: '123' }, { signal: undefined })
  })

  it('should handle deserialization errors and return a 400 response', async () => {
    const handler = new ORPCHandler(router)

    const mockRequest = new Request('https://example.com/ping', {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: '{ invalid json',
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(400)

    const body = await response?.text()
    expect(body).toContain('Cannot parse request')
  })

  it('should handle unexpected errors and return a 500 response', async () => {
    const handler = new ORPCHandler(router)

    vi.mocked(createProcedureClient).mockImplementationOnce(() => {
      throw new Error('Unexpected error')
    })

    const mockRequest = new Request('https://example.com/ping', {
      headers: new Headers({ }),
      method: 'POST',
      body: JSON.stringify({ data: { value: '123' }, meta: [] }),
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(500)

    const body = await response?.text()
    expect(body).toContain('Internal server error')
  })

  it('support signal', async () => {
    const handler = new ORPCHandler(router)

    const caller = vi.fn().mockReturnValueOnce('__mocked__')
    vi.mocked(createProcedureClient).mockReturnValue(caller)

    const mockRequest = new Request('https://example.com/ping', {
      headers: new Headers({ }),
      method: 'POST',
      body: JSON.stringify({ data: { value: '123' }, meta: [] }),
    })

    const controller = new AbortController()
    const signal = controller.signal

    const response = await handler.fetch(mockRequest, { signal })

    expect(response?.status).toBe(200)

    const body = await response?.json()
    expect(body).toEqual({ data: '__mocked__', meta: [] })

    expect(caller).toBeCalledTimes(1)
    expect(caller).toBeCalledWith({ value: '123' }, { signal })
  })

  it('hooks', async () => {
    const mockRequest = new Request('https://example.com/not_found', {
      headers: new Headers({ }),
      method: 'POST',
      body: JSON.stringify({ data: { value: '123' }, meta: [] }),
    })

    const onStart = vi.fn()
    const onSuccess = vi.fn()
    const onError = vi.fn()

    const handler = new ORPCHandler(router, {
      onStart,
      onSuccess,
      onError,
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(404)

    expect(onStart).toBeCalledTimes(1)
    expect(onSuccess).toBeCalledTimes(0)
    expect(onError).toBeCalledTimes(1)
  })

  it('conditions', () => {
    const handler = new ORPCHandler(router)

    expect(handler.condition(new Request('https://example.com'))).toBe(false)
    expect(handler.condition(new Request('https://example.com', {
      headers: new Headers({ [ORPC_HANDLER_HEADER]: ORPC_HANDLER_VALUE }),
    }))).toBe(true)
  })
})

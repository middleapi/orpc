import type { StandardLazyRequest } from '@standard-server/core'
import { meta } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { os } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import { NestHandlerCodec } from './handler-codec'

describe('nestHandlerCodec', () => {
  function createRequest(overrides: Partial<StandardLazyRequest> = {}): StandardLazyRequest {
    return {
      method: 'POST',
      url: '/',
      resolveBody: vi.fn(async () => undefined),
      headers: {},
      signal: undefined,
      ...overrides,
    }
  }

  describe('.resolveProcedure', () => {
    it('returns undefined outside of .run', () => {
      const codec = new NestHandlerCodec()

      expect(codec.resolveProcedure(createRequest())).toBeUndefined()
    })

    it('resolves the procedure stored by .run', async () => {
      const codec = new NestHandlerCodec()
      const procedure = os.meta(openapi({ path: '/planets/{id}' })).handler(vi.fn())
      const request = createRequest({ resolveBody: vi.fn(async () => ({ name: 'Earth' })) })

      const result = await codec.run(
        { procedure, params: { id: '1' } },
        async () => codec.resolveProcedure(request),
      )

      expect(result?.procedure).toBe(procedure)
      expect(result?.path).toEqual([])
      await expect(result!.decodeInput()).resolves.toEqual({ id: '1', name: 'Earth' })
      expect(request.resolveBody).toHaveBeenCalledTimes(1)
    })

    it('uses meta.path as path', () => {
      const codec = new NestHandlerCodec()
      const procedure = os
        .meta(openapi({ path: '/planets' }))
        .meta(meta.path(['planet', 'list']))
        .handler(vi.fn())

      const result = codec.run(
        { procedure, params: undefined },
        () => codec.resolveProcedure(createRequest()),
      )

      expect(result?.path).toEqual(['planet', 'list'])
    })

    it('maps nest rest params to oRPC params', async () => {
      const codec = new NestHandlerCodec()
      const procedure = os.meta(openapi({ prefix: '/api', path: '/files/{+path}' })).handler(vi.fn())

      const express = codec.run(
        { procedure, params: { path: ['a', 'b'] } },
        () => codec.resolveProcedure(createRequest({ method: 'GET', url: '/api/files/a/b' })),
      )
      await expect(express!.decodeInput()).resolves.toEqual({ path: 'a/b' })

      const fastify = codec.run(
        { procedure, params: { '*': 'a/b' } },
        () => codec.resolveProcedure(createRequest({ method: 'GET', url: '/api/files/a/b' })),
      )
      await expect(fastify!.decodeInput()).resolves.toEqual({ path: 'a/b' })
    })

    it('keeps concurrent runs isolated', async () => {
      const codec = new NestHandlerCodec()
      const procedure1 = os.meta(openapi({ path: '/one' })).handler(vi.fn())
      const procedure2 = os.meta(openapi({ path: '/two' })).handler(vi.fn())

      const [result1, result2] = await Promise.all([
        codec.run({ procedure: procedure1, params: undefined }, async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return codec.resolveProcedure(createRequest())
        }),
        codec.run({ procedure: procedure2, params: undefined }, async () => {
          return codec.resolveProcedure(createRequest())
        }),
      ])

      expect(result1?.procedure).toBe(procedure1)
      expect(result2?.procedure).toBe(procedure2)
    })
  })
})

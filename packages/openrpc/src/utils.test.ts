import type { AnySchema } from '@orpc/contract'
import { asyncIteratorObject, oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { z } from 'zod'
import {
  acceptsEmptyObject,
  assertJsonRpcErrorCodeMap,
  isEventIteratorProcedure,
  isJsonRpcId,
  isVoidLikeSchemas,
  toProcedurePath,
} from './utils'

function customSchema(validate: (value: unknown) => any): AnySchema {
  return { '~standard': { version: 1, vendor: 'custom', validate } }
}

describe('isJsonRpcId', () => {
  it.each([['abc'], [''], [1], [0], [-1.5], [null]])('accepts %j', (value) => {
    expect(isJsonRpcId(value)).toBe(true)
  })

  it.each([[undefined], [{}], [[]], [true], [Number.NaN], [Number.POSITIVE_INFINITY], [1n]])('rejects %s', (value) => {
    expect(isJsonRpcId(value)).toBe(false)
  })
})

describe('toProcedurePath', () => {
  it.each([
    ['a', ['a']],
    ['a.b', ['a', 'b']],
    ['rpc', ['rpc']],
    ['rpcx.discover', ['rpcx', 'discover']],
    ['RPC.discover', ['RPC', 'discover']],
    ['a/b.c', ['a/b', 'c']],
    ['pl%61net.find', ['pl%61net', 'find']],
    ['eth_getBalance', ['eth_getBalance']],
  ])('splits %j', (method, path) => {
    expect(toProcedurePath(method)).toEqual(path)
  })

  it.each([
    ['rpc.discover'],
    ['rpc.'],
    ['rpc.a.b'],
    [''],
    ['.a'],
    ['a.'],
    ['a..b'],
    ['.'],
  ])('rejects %j', (method) => {
    expect(toProcedurePath(method)).toBeUndefined()
  })
})

describe('isEventIteratorProcedure', () => {
  it('detects event iterator inputs', () => {
    expect(isEventIteratorProcedure(oc.input(asyncIteratorObject(z.string())))).toBe(true)
  })

  it('detects event iterator outputs, including among several schemas', () => {
    expect(isEventIteratorProcedure(oc.output(asyncIteratorObject(z.string(), z.number())))).toBe(true)
    expect(isEventIteratorProcedure(oc.output(z.any()).output(asyncIteratorObject(z.string())))).toBe(true)
    expect(isEventIteratorProcedure(os.output(asyncIteratorObject(z.string())).handler(async function* () {}))).toBe(true)
  })

  it('ignores other procedures', () => {
    expect(isEventIteratorProcedure(oc)).toBe(false)
    expect(isEventIteratorProcedure(oc.input(z.string()).output(z.number()))).toBe(false)
    expect(isEventIteratorProcedure(os.handler(() => 1))).toBe(false)
  })
})

describe('acceptsEmptyObject', () => {
  it.each([
    ['z.object({})', z.object({})],
    ['z.object({ a: optional })', z.object({ a: z.string().optional() })],
    ['z.any()', z.any()],
    ['z.object({}).optional()', z.object({}).optional()],
  ])('accepts {} with %s', (_, schema) => {
    expect(acceptsEmptyObject(schema)).toBe(true)
  })

  it.each([
    ['z.void()', z.void()],
    ['z.object({ a: required })', z.object({ a: z.string() })],
    ['z.string()', z.string()],
    ['z.array()', z.array(z.string())],
  ])('rejects {} with %s', (_, schema) => {
    expect(acceptsEmptyObject(schema)).toBe(false)
  })

  it('returns false for async validation without an unhandled rejection', async () => {
    const onUnhandledRejection = vi.fn()
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      expect(acceptsEmptyObject(z.object({}).refine(async () => true))).toBe(false)
      expect(acceptsEmptyObject(customSchema(() => Promise.reject(new Error('async failure'))))).toBe(false)

      await new Promise(resolve => setTimeout(resolve, 10))
      expect(onUnhandledRejection).not.toHaveBeenCalled()
    }
    finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('returns false when validation throws', () => {
    expect(acceptsEmptyObject(customSchema(() => {
      throw new Error('sync failure')
    }))).toBe(false)
  })
})

describe('isVoidLikeSchemas', () => {
  it('detects void-like schemas', () => {
    expect(isVoidLikeSchemas([z.void()], 'input')).toBe(true)
    expect(isVoidLikeSchemas([z.void()], 'output')).toBe(true)
    expect(isVoidLikeSchemas([z.undefined()], 'input')).toBe(true)
    expect(isVoidLikeSchemas([z.any(), z.void()], 'input')).toBe(true)
  })

  it('ignores schemas that accept {} or reject undefined', () => {
    expect(isVoidLikeSchemas([], 'input')).toBe(false)
    expect(isVoidLikeSchemas([z.any()], 'input')).toBe(false)
    expect(isVoidLikeSchemas([z.unknown()], 'output')).toBe(false)
    expect(isVoidLikeSchemas([z.object({}).optional()], 'input')).toBe(false)
    expect(isVoidLikeSchemas([z.string()], 'input')).toBe(false)
    expect(isVoidLikeSchemas([z.void(), z.string()], 'input')).toBe(false)
  })

  it('respects the direction', () => {
    const schema = z.void().transform(() => 'value')

    expect(isVoidLikeSchemas([schema], 'input')).toBe(true)
    expect(isVoidLikeSchemas([schema], 'output')).toBe(false)
  })

  it('treats async and throwing schemas as not void-like', () => {
    expect(isVoidLikeSchemas([z.void().refine(async () => true)], 'input')).toBe(false)
    expect(isVoidLikeSchemas([customSchema(() => {
      throw new Error('sync failure')
    })], 'input')).toBe(false)
  })
})

describe('assertJsonRpcErrorCodeMap', () => {
  it('accepts undefined and integer maps', () => {
    expect(() => assertJsonRpcErrorCodeMap(undefined, 'Owner')).not.toThrow()
    expect(() => assertJsonRpcErrorCodeMap({}, 'Owner')).not.toThrow()
    expect(() => assertJsonRpcErrorCodeMap({ OUT_OF_STOCK: 1001, BAD_REQUEST: -32602, ZERO: 0 }, 'Owner')).not.toThrow()
  })

  it.each([
    [1.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [2 ** 60],
    ['1'],
    [undefined],
  ])('rejects %s', (code) => {
    expect(() => assertJsonRpcErrorCodeMap({ OUT_OF_STOCK: code as any }, 'OpenRPCHandler')).toThrow(
      new TypeError(`[OpenRPCHandler] "errorCodeMap.OUT_OF_STOCK" must be an integer JSON-RPC error code, received ${String(code)}.`),
    )
  })
})

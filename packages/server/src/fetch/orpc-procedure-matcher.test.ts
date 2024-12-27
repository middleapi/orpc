import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { os } from '..'
import { isProcedure } from '../procedure'
import { ORPCProcedureMatcher } from './orpc-procedure-matcher'

describe('oRPCProcedureMatcher', () => {
  const schema = z.object({ val: z.string().transform(v => Number(v)) })
  const ping = os.input(schema).handler(() => 'pong')
  const pong = os.output(schema).handler(() => ({ val: '1' }))

  const router = {
    ping: os.lazy(() => Promise.resolve({ default: ping })),
    pong,
    nested: os.lazy(() => Promise.resolve({
      default: {
        ping,
        pong: os.lazy(() => Promise.resolve({ default: pong })),
      },
    })),
  }

  const matcher = new ORPCProcedureMatcher(router)

  it('should return undefined if no match is found in the router', async () => {
    const result = await matcher.match('/nonexistent/path')
    expect(result).toBeUndefined()
  })

  it('should return undefined if the match is not a procedure', async () => {
    const result = await matcher.match('/nested')
    expect(result).toBeUndefined()
  })

  it('should return the procedure and path if a valid procedure is matched', async () => {
    const result = await matcher.match('/pong')
    expect(result?.path).toEqual(['pong'])
    expect(result?.procedure).toSatisfy(isProcedure)
    expect(result?.procedure).toBe(pong)
  })

  it('should return the procedure and path if a valid procedure is matched on lazy', async () => {
    const result = await matcher.match('/nested/pong')
    expect(result?.path).toEqual(['nested', 'pong'])
    expect(result?.procedure).toSatisfy(isProcedure)
    expect(result?.procedure['~orpc'].handler).toBe(pong['~orpc'].handler)
  })

  it('should handle deeply nested lazy-loaded procedures', async () => {
    const result = await matcher.match('/nested/ping')
    expect(result?.path).toEqual(['nested', 'ping'])
    expect(result?.procedure).toSatisfy(isProcedure)
    expect(result?.procedure['~orpc'].handler).toBe(ping['~orpc'].handler)
  })

  it('should decode URI components in the path', async () => {
    const result = await matcher.match('/nested/%70ing') // '%70' decodes to 'p'
    expect(result?.path).toEqual(['nested', 'ping'])
    expect(result?.procedure).toSatisfy(isProcedure)
    expect(result?.procedure['~orpc'].handler).toBe(ping['~orpc'].handler)
  })

  it('should handle empty path correctly', async () => {
    const result = await matcher.match('/')
    expect(result).toBeUndefined()
  })

  it('should trim leading and trailing slashes in the path', async () => {
    const result = await matcher.match('/nested/pong/')
    expect(result?.path).toEqual(['nested', 'pong'])
    expect(result?.procedure).toSatisfy(isProcedure)
    expect(result?.procedure['~orpc'].handler).toBe(pong['~orpc'].handler)
  })

  it('should return undefined for a path that matches a non-lazy non-procedure', async () => {
    const result = await matcher.match('/nested/pong/invalid')
    expect(result).toBeUndefined()
  })

  it('should support matching root-level lazy procedures', async () => {
    const result = await matcher.match('/ping')
    expect(result?.path).toEqual(['ping'])
    expect(result?.procedure).toSatisfy(isProcedure)
    expect(result?.procedure['~orpc'].handler).toBe(ping['~orpc'].handler)
  })
})

import { NullProtoObj } from '@orpc/shared'
import { ORPCError } from './error'

describe('oRPCError', () => {
  it('works', () => {
    const error = new ORPCError('BAD_GATEWAY', {
      message: 'message',
      data: 'data',
      cause: 'cause',
    })
    expect(error.defined).toBe(false)
    expect(error.inferable).toBe(false)
    expect(error.code).toBe('BAD_GATEWAY')
    expect(error.message).toBe('message')
    expect(error.data).toBe('data')
    expect(error.cause).toBe('cause')
    expect(Object.getPrototypeOf(error).constructor.name).toBe('ORPCError')
  })

  it('can fallback message', () => {
    const error = new ORPCError('BAD_GATEWAY')
    expect(error.message).toBe('Bad Gateway')
  })

  it('can force write .defined or .inferable', () => {
    const error = new ORPCError('BAD_GATEWAY')

    expect(error.defined).toBe(false)
    expect(error.inferable).toBe(false)

    ;(error.defined as any) = true
    ;(error.inferable as any) = true

    expect(error.defined).toBe(true)
    expect(error.inferable).toBe(true)
  })

  it('.toJSON', () => {
    const error = new ORPCError('BAD_GATEWAY', { message: 'message', data: 'data', cause: 'cause' })
    expect(error.toJSON()).toEqual({
      defined: false,
      inferable: false,
      code: 'BAD_GATEWAY',
      message: 'message',
      data: 'data',
    })
  })

  it('instanceof should behave as normal', () => {
    class ExtendedORPCError extends ORPCError<any, any> {}
    class NotRelated {}

    const orpcError = new ORPCError('test')
    const extendedError = new ExtendedORPCError('test')
    const pureError = new Error('test')
    const notRelated = new NotRelated()
    const nullProtoObj = new NullProtoObj()

    expect(orpcError instanceof ORPCError).toBe(true)
    expect(extendedError instanceof ORPCError).toBe(true)
    expect(pureError instanceof ORPCError).toBe(false)
    expect(notRelated instanceof ORPCError).toBe(false)
    expect(nullProtoObj instanceof ORPCError).toBe(false)

    expect(orpcError instanceof ExtendedORPCError).toBe(false)
    expect(extendedError instanceof ExtendedORPCError).toBe(true)
    expect(pureError instanceof ExtendedORPCError).toBe(false)
    expect(notRelated instanceof ExtendedORPCError).toBe(false)
    expect(nullProtoObj instanceof ExtendedORPCError).toBe(false)

    expect(orpcError instanceof Error).toBe(true)
    expect(extendedError instanceof Error).toBe(true)
    expect(pureError instanceof Error).toBe(true)
    expect(notRelated instanceof Error).toBe(false)
    expect(nullProtoObj instanceof Error).toBe(false)

    expect(orpcError instanceof NotRelated).toBe(false)
    expect(extendedError instanceof NotRelated).toBe(false)
    expect(pureError instanceof NotRelated).toBe(false)
    expect(notRelated instanceof NotRelated).toBe(true)
    expect(nullProtoObj instanceof NotRelated).toBe(false)
  })
})

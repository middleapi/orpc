import { ORPCError } from '@orpc/client'
import z from 'zod'
import { createORPCErrorConstructorMap } from './error'

describe('createORPCErrorConstructorMap', () => {
  const errorMap = {
    BAD_GATEWAY: {
      message: 'default message',
      data: z.object({ output: z.number() }),
    },
  }

  const constructors = createORPCErrorConstructorMap(errorMap)

  it('works', () => {
    const error = constructors.BAD_GATEWAY({ data: { output: 123 }, cause: 'cause' })

    expect(error).toBeInstanceOf(ORPCError)
    expect(error.code).toEqual('BAD_GATEWAY')
    expect(error.defined).toBe(true)
    expect(error.inferable).toBe(true)
    expect(error.message).toBe('default message')
    expect(error.data).toEqual({ output: 123 })
    expect(error.cause).toBe('cause')
  })

  it('can override message', () => {
    expect(
      constructors.BAD_GATEWAY({ message: 'custom message', data: { output: 123 } }).message,
    ).toBe('custom message')
  })

  it('fallback normal error when access undefined code', () => {
    // @ts-expect-error - invalid access
    const error = constructors.ANY_THING({ data: 'DATA', message: 'MESSAGE', cause: 'cause' })

    expect(error).toBeInstanceOf(ORPCError)
    expect(error.code).toEqual('ANY_THING')
    expect(error.defined).toBe(false)
    expect(error.inferable).toBe(false)
    expect(error.message).toBe('MESSAGE')
    expect(error.data).toEqual('DATA')
    expect(error.cause).toBe('cause')
  })

  it('works with no options', () => {
    // @ts-expect-error - missing data
    const error = constructors.BAD_GATEWAY()

    expect(error).toBeInstanceOf(ORPCError)
    expect(error.code).toEqual('BAD_GATEWAY')
    expect(error.message).toBe('default message')
    expect(error.data).toBeUndefined()
    expect(error.defined).toBe(true)
    expect(error.inferable).toBe(true)
  })

  it('not proxy when access with symbol', () => {
    // @ts-expect-error - invalid access
    expect(constructors[Symbol('something')]).toBeUndefined()
  })

  it('in operator works', () => {
    expect('BAD_GATEWAY' in constructors).toBe(true)
    expect('ANY_THING' in constructors).toBe(false)
  })
})

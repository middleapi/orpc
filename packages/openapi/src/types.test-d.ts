import type { Client, ORPCError } from '@orpc/client'
import type { JsonifiedClient, JsonifiedValue } from './types'

describe('JsonifiedValue', () => {
  it('flat', () => {
    expectTypeOf<JsonifiedValue<string>>().toEqualTypeOf<string>()
    expectTypeOf<JsonifiedValue<number>>().toEqualTypeOf<number>()
    expectTypeOf<JsonifiedValue<boolean>>().toEqualTypeOf<boolean>()
    expectTypeOf<JsonifiedValue<null>>().toEqualTypeOf<null>()
    expectTypeOf<JsonifiedValue<undefined>>().toEqualTypeOf<undefined>()
    expectTypeOf<JsonifiedValue<Date>>().toEqualTypeOf<string>()
    expectTypeOf<JsonifiedValue<bigint>>().toEqualTypeOf<string>()
    expectTypeOf<JsonifiedValue<RegExp>>().toEqualTypeOf<string>()
    expectTypeOf<JsonifiedValue<URL>>().toEqualTypeOf<string>()
    expectTypeOf<JsonifiedValue<File>>().toEqualTypeOf<File>()
    expectTypeOf<JsonifiedValue<Blob>>().toEqualTypeOf<Blob>()
    expectTypeOf<JsonifiedValue<Map<string, number>>>().toEqualTypeOf<[string, number][]>()
    expectTypeOf<JsonifiedValue<Set<number>>>().toEqualTypeOf<number[]>()
    expectTypeOf<JsonifiedValue<Array<number>>>().toEqualTypeOf<number[]>()
    expectTypeOf<JsonifiedValue<{ a: number, b: Date }>>().toEqualTypeOf<{ a: number, b: string }>()
    expectTypeOf<JsonifiedValue<AsyncGenerator<Date, Date>>>().toEqualTypeOf<AsyncIteratorObject<string, string>>()

    expectTypeOf<JsonifiedValue<DateConstructor>>().toEqualTypeOf<unknown>()
  })

  it('complex', () => {
    expectTypeOf<
      JsonifiedValue<Set<{ a: number, b: Date, c: [Date, 1, 2, 3, ...Date[]], g: DateConstructor }>>
    >().toEqualTypeOf<
      { a: number, b: string, c: [string, 1, 2, 3, ...string[]], g: unknown }[]
    >()
  })
})

describe('JsonifiedClient', () => {
  it('leaf-level', () => {
    expectTypeOf<JsonifiedClient<
      Client<{ cache?: boolean }, { now: Date }, { b: Set<Date> }, Error | ORPCError<string, { a: Date }>>
    >>().toEqualTypeOf<
      Client<{ cache?: boolean }, { now: Date }, { b: string[] }, Error | ORPCError<string, { a: string }>>
    >()
  })

  it('nested', () => {
    expectTypeOf<JsonifiedClient<{
      ping: Client<{ cache?: boolean }, { now: Date }, { b: Set<Date> }, Error | ORPCError<string, { a: Date }>>
      planet: {
        find: Client<{ cache?: boolean }, { now: Date }, { b: Set<Date> }, Error | ORPCError<string, { a: Date }>>
      }
    }>>().toEqualTypeOf<{
      ping: Client<{ cache?: boolean }, { now: Date }, { b: string[] }, Error | ORPCError<string, { a: string }>>
      planet: {
        find: Client<{ cache?: boolean }, { now: Date }, { b: string[] }, Error | ORPCError<string, { a: string }>>
      }
    }>()
  })
})

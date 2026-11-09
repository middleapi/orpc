import type { Promisable } from 'type-fest'

import type { Value } from './value'
import { value } from './value'

describe('value', () => {
  it('types', () => {
    let v: Value<Promisable<number>> = 42

    v = async () => 42
    v = () => 42

    // @ts-expect-error - not a number
    v = null

    // @ts-expect-error - not a number
    v = 'string'
  })

  it('function', () => {
    const n: number = 42
    expectTypeOf(value(n)).toEqualTypeOf<number>()
    expectTypeOf(value(() => n)).toEqualTypeOf<number>()
    expectTypeOf(value(async () => n)).toEqualTypeOf<Promise<number>>()
  })

  it('args', () => {
    const v = {} as Value<string, [string, number]>
    // @ts-expect-error missing args
    value(v)
    // @ts-expect-error missing args
    value(v, 'hello')
    value(v, 'hello', 123)
    // @ts-expect-error wrong args
    value(v, 'hello', '456')
  })
})

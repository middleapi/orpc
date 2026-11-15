import type { Schema } from '@orpc/contract'
import { expectTypeOf } from 'vitest'

import type { Procedure } from './procedure'

type P<TInitialContext extends object, TInjectedContext extends object> = Procedure<
  TInitialContext,
  TInjectedContext,
  Schema<unknown, unknown>,
  Schema<unknown, unknown>,
  Record<never, never>
>

describe('Procedure', () => {
  it('initial context is contravariant', () => {
    // a procedure needing less initial context can be used where more is provided
    expectTypeOf<P<{ db: string }, object>>().toExtend<P<{ db: string; user: number }, object>>()
    expectTypeOf<P<{ db: string; user: number }, object>>().not.toExtend<
      P<{ db: string }, object>
    >()
  })

  it('injected context is covariant', () => {
    // a procedure injecting more context can be used where less is expected
    expectTypeOf<P<object, { user: 1; admin: true }>>().toExtend<P<object, { user: 1 }>>()
    expectTypeOf<P<object, { user: 1 }>>().not.toExtend<P<object, { user: 1; admin: true }>>()
  })
})

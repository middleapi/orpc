import type { AnyORPCError, ORPCErrorCode } from '@orpc/client'
import { ORPCError } from '@orpc/client'
import { Effect } from 'effect'
import { catchORPCError, catchORPCErrorCode, catchORPCErrorCodes } from './error'

class Service1 {
  declare id: 'Service1'
}

class Service2 {
  declare id: 'Service2'
}

const effect = {} as Effect.Effect<
  'output',
  ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'CONFLICT', number>,
  Service1
>

const effectWithHidden = {} as Effect.Effect<
  'output',
  ORPCError<'NOT_FOUND', { id: string }> | Error,
  Service1
>

const effectWithAny = Effect.fail(new Error('boom') as unknown).pipe(
  Effect.mapError(error => error instanceof ORPCError ? error : new ORPCError('INTERNAL_SERVER_ERROR')),
)

const effectWithWide = {} as Effect.Effect<'output', ORPCError<ORPCErrorCode, unknown>>
const effectWithString = {} as Effect.Effect<'output', ORPCError<string, unknown>>
const effectWithUnion = {} as Effect.Effect<'output', ORPCError<'NOT_FOUND' | 'CONFLICT', { id: string }>>

describe('catchORPCError', () => {
  it('catches every ORPCError and excludes them from the error channel (data-last)', () => {
    const recovered = effect.pipe(catchORPCError((error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'CONFLICT', number>>()
      return Effect.succeed('recovered' as const)
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'recovered', never, Service1>>()
  })

  it('catches every ORPCError and excludes them from the error channel (data-first)', () => {
    const recovered = catchORPCError(effect, (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'CONFLICT', number>>()
      return Effect.succeed('recovered' as const)
    })

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'recovered', never, Service1>>()
  })

  it('merges handler error and requirement channels into the result', () => {
    const recovered = effect.pipe(
      catchORPCError(() => ({} as Effect.Effect<'recovered', RangeError, Service2>)),
    )

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'recovered', RangeError, Service1 | Service2>>()
  })

  it('also receives hidden ORPCErrors, with unknown code and data', () => {
    const recovered = effectWithHidden.pipe(catchORPCError((error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }> | ORPCError<ORPCErrorCode, unknown>>()
      expectTypeOf(error.data).toEqualTypeOf<unknown>()
      return Effect.succeed('recovered' as const)
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'recovered', Error, Service1>>()
  })

  it('treats failure types that can hold an ORPCError as possibly hiding one', () => {
    const withTypeError = {} as Effect.Effect<'output', ORPCError<'NOT_FOUND', { id: string }> | TypeError>

    void withTypeError.pipe(catchORPCError((error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }> | ORPCError<ORPCErrorCode, unknown>>()
      expectTypeOf(error.data).toEqualTypeOf<unknown>()
      return Effect.succeed('recovered' as const)
    }))
  })

  it('does not treat failure types that cannot hold an ORPCError as hidden', () => {
    const withString = {} as Effect.Effect<'output', ORPCError<'NOT_FOUND', { id: string }> | 'boom'>

    void withString.pipe(catchORPCError((error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }>>()
      expectTypeOf(error.data).toEqualTypeOf<{ id: string }>()
      return Effect.succeed('recovered' as const)
    }))

    const onlyString = {} as Effect.Effect<'output', 'boom'>

    void onlyString.pipe(catchORPCError((error) => {
      expectTypeOf(error).toEqualTypeOf<never>()
      return Effect.succeed('recovered' as const)
    }))
  })
})

describe('catchORPCErrorCode', () => {
  it('catches ORPCErrors with a matching code and excludes them from the error channel (data-last)', () => {
    const recovered = effect.pipe(catchORPCErrorCode('NOT_FOUND', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }>>()
      return Effect.succeed('recovered' as const)
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'recovered', ORPCError<'CONFLICT', number>, Service1>>()
  })

  it('catches ORPCErrors with a matching code and excludes them from the error channel (data-first)', () => {
    const recovered = catchORPCErrorCode(effect, 'CONFLICT', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'CONFLICT', number>>()
      return Effect.succeed('recovered' as const)
    })

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'recovered', ORPCError<'NOT_FOUND', { id: string }>, Service1>>()
  })

  it('merges handler error and requirement channels into the result', () => {
    const recovered = effect.pipe(
      catchORPCErrorCode('NOT_FOUND', () => ({} as Effect.Effect<'recovered', RangeError, Service2>)),
    )

    expectTypeOf(recovered).toEqualTypeOf<
      Effect.Effect<'output' | 'recovered', ORPCError<'CONFLICT', number> | RangeError, Service1 | Service2>
    >()
  })

  it('supports custom error codes', () => {
    const custom = {} as Effect.Effect<'output', ORPCError<'__CUSTOM__', undefined>>

    const recovered = custom.pipe(catchORPCErrorCode('__CUSTOM__', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'__CUSTOM__', undefined>>()
      return Effect.succeed('recovered' as const)
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'recovered', never, never>>()
  })

  it('suggests and restricts the code to those present in the error channel', () => {
    // @ts-expect-error - BAD_GATEWAY is not present in the error channel (data-last)
    void effect.pipe(catchORPCErrorCode('BAD_GATEWAY', () => Effect.succeed('recovered')))

    // @ts-expect-error - BAD_GATEWAY is not present in the error channel (data-first)
    void catchORPCErrorCode(effect, 'BAD_GATEWAY', () => Effect.succeed('recovered'))

    // @ts-expect-error - code must be a string
    void effect.pipe(catchORPCErrorCode(123, () => Effect.succeed('recovered')))
  })

  it('widens data to unknown on declared codes when the channel can hold hidden ORPCErrors', () => {
    const recovered = effectWithHidden.pipe(catchORPCErrorCode('NOT_FOUND', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'NOT_FOUND', unknown>>()
      expectTypeOf(error.data).toEqualTypeOf<unknown>()
      return Effect.succeed('recovered' as const)
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'recovered', Error, Service1>>()
  })

  it('accepts undeclared codes when the channel can hold hidden ORPCErrors', () => {
    const recovered = effectWithHidden.pipe(catchORPCErrorCode('CONFLICT', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'CONFLICT', unknown>>()
      return Effect.succeed('recovered' as const)
    }))

    expectTypeOf(recovered).toEqualTypeOf<
      Effect.Effect<'output' | 'recovered', ORPCError<'NOT_FOUND', { id: string }> | Error, Service1>
    >()
  })

  it('unknown error channels can also hold hidden ORPCErrors', () => {
    const withUnknown = {} as Effect.Effect<'output', unknown>

    void withUnknown.pipe(catchORPCErrorCode('CONFLICT', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'CONFLICT', unknown>>()
      return Effect.succeed('recovered' as const)
    }))
  })

  it('keeps data typed and codes restricted when the channel cannot hold hidden ORPCErrors', () => {
    const withString = {} as Effect.Effect<'output', ORPCError<'NOT_FOUND', { id: string }> | 'boom'>

    void withString.pipe(catchORPCErrorCode('NOT_FOUND', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }>>()
      expectTypeOf(error.data).toEqualTypeOf<{ id: string }>()
      return Effect.succeed('recovered' as const)
    }))

    // @ts-expect-error - BAD_GATEWAY is not present and the channel cannot hold hidden ORPCErrors
    void withString.pipe(catchORPCErrorCode('BAD_GATEWAY', () => Effect.succeed('recovered')))
  })

  it('keeps AnyORPCError in the error channel and narrows the handler to the caught code', () => {
    expectTypeOf(effectWithAny).toEqualTypeOf<Effect.Effect<never, AnyORPCError>>()

    const recovered = effectWithAny.pipe(catchORPCErrorCode('NOT_FOUND', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', any>>()
      return Effect.succeed(error.code)
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'NOT_FOUND', AnyORPCError>>()
  })

  it('narrows wide codes to the caught code and keeps them in the error channel', () => {
    const recoveredWide = effectWithWide.pipe(catchORPCErrorCode('NOT_FOUND', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', unknown>>()
      return Effect.succeed(error.code)
    }))

    expectTypeOf(recoveredWide).toEqualTypeOf<Effect.Effect<'output' | 'NOT_FOUND', ORPCError<ORPCErrorCode, unknown>>>()

    const recoveredString = catchORPCErrorCode(effectWithString, 'NOT_FOUND', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', unknown>>()
      return Effect.succeed(error.code)
    })

    expectTypeOf(recoveredString).toEqualTypeOf<Effect.Effect<'output' | 'NOT_FOUND', ORPCError<string, unknown>>>()
  })

  it('narrows union codes to the caught code and keeps them in the error channel', () => {
    const recovered = effectWithUnion.pipe(catchORPCErrorCode('NOT_FOUND', (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }>>()
      return Effect.succeed(error.data.id)
    }))

    expectTypeOf(recovered).toEqualTypeOf<
      Effect.Effect<'output' | string, ORPCError<'NOT_FOUND' | 'CONFLICT', { id: string }>>
    >()
  })

  it('keeps errors in the error channel when the code is not a single literal', () => {
    const code = {} as 'NOT_FOUND' | 'CONFLICT'

    const recoveredUnion = effect.pipe(catchORPCErrorCode(code, (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'CONFLICT', number>>()
      return Effect.succeed('recovered' as const)
    }))

    expectTypeOf(recoveredUnion).toEqualTypeOf<
      Effect.Effect<'output' | 'recovered', ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'CONFLICT', number>, Service1>
    >()

    const recoveredString = effectWithHidden.pipe(catchORPCErrorCode({} as string, (error) => {
      expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }> | ORPCError<string, unknown>>()
      return Effect.succeed('recovered' as const)
    }))

    expectTypeOf(recoveredString).toEqualTypeOf<
      Effect.Effect<'output' | 'recovered', ORPCError<'NOT_FOUND', { id: string }> | Error, Service1>
    >()
  })

  it('keeps ORPCError subclasses', () => {
    class NotFoundError extends ORPCError<'NOT_FOUND', { id: string }> {
      declare readonly extra: 'extra'
    }

    const withSubclass = {} as Effect.Effect<'output', NotFoundError | ORPCError<'CONFLICT', number>>

    const recovered = withSubclass.pipe(catchORPCErrorCode('NOT_FOUND', (error) => {
      expectTypeOf(error).toEqualTypeOf<NotFoundError>()
      return Effect.succeed(error.extra)
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'extra', ORPCError<'CONFLICT', number>>>()
  })
})

describe('catchORPCErrorCodes', () => {
  it('narrows each handler and excludes handled codes from the error channel (data-last)', () => {
    const recovered = effect.pipe(catchORPCErrorCodes({
      NOT_FOUND: (error) => {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }>>()
        return Effect.succeed('nf' as const)
      },
      CONFLICT: (error) => {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'CONFLICT', number>>()
        return {} as Effect.Effect<'cf', RangeError, Service2>
      },
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'nf' | 'cf', RangeError, Service1 | Service2>>()
  })

  it('keeps unhandled codes in the error channel (data-first)', () => {
    const recovered = catchORPCErrorCodes(effect, {
      NOT_FOUND: (error) => {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }>>()
        return Effect.succeed('nf' as const)
      },
    })

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'nf', ORPCError<'CONFLICT', number>, Service1>>()
  })

  it('suggests and restricts keys to the codes present in the error channel', () => {
    // @ts-expect-error - BAD_GATEWAY is not present in the error channel (data-last)
    void effect.pipe(catchORPCErrorCodes({ BAD_GATEWAY: () => Effect.succeed('recovered') }))

    // @ts-expect-error - BAD_GATEWAY is not present in the error channel (data-first)
    void catchORPCErrorCodes(effect, { BAD_GATEWAY: () => Effect.succeed('recovered') })
  })

  it('widens data to unknown and accepts undeclared keys when the channel can hold hidden ORPCErrors', () => {
    const recovered = effectWithHidden.pipe(catchORPCErrorCodes({
      NOT_FOUND: (error) => {
        expectTypeOf(error.data).toEqualTypeOf<unknown>()
        return Effect.succeed('nf' as const)
      },
      CONFLICT: (error) => {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'CONFLICT', unknown>>()
        return Effect.succeed('cf' as const)
      },
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'output' | 'nf' | 'cf', Error, Service1>>()
  })

  it('keeps data typed and keys restricted when the channel cannot hold hidden ORPCErrors', () => {
    const withString = {} as Effect.Effect<'output', ORPCError<'NOT_FOUND', { id: string }> | 'boom'>

    void withString.pipe(catchORPCErrorCodes({
      NOT_FOUND: (error) => {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }>>()
        expectTypeOf(error.data).toEqualTypeOf<{ id: string }>()
        return Effect.succeed('recovered' as const)
      },
    }))

    // @ts-expect-error - BAD_GATEWAY is not present and the channel cannot hold hidden ORPCErrors
    void withString.pipe(catchORPCErrorCodes({ BAD_GATEWAY: () => Effect.succeed('recovered') }))
  })

  it('keeps AnyORPCError in the error channel', () => {
    const recovered = effectWithAny.pipe(catchORPCErrorCodes({
      NOT_FOUND: (error) => {
        expectTypeOf(error).toEqualTypeOf<AnyORPCError>()
        return Effect.succeed('nf' as const)
      },
    }))

    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<'nf', AnyORPCError>>()
  })

  it('types handlers of wide codes and keeps them in the error channel', () => {
    const recoveredWide = effectWithWide.pipe(catchORPCErrorCodes({
      NOT_FOUND: (error) => {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', unknown>>()
        return Effect.succeed('nf' as const)
      },
    }))

    expectTypeOf(recoveredWide).toEqualTypeOf<Effect.Effect<'output' | 'nf', ORPCError<ORPCErrorCode, unknown>>>()

    const recoveredString = catchORPCErrorCodes(effectWithString, {
      NOT_FOUND: (error) => {
        expectTypeOf(error).toEqualTypeOf<ORPCError<string, unknown>>()
        return Effect.succeed('nf' as const)
      },
    })

    expectTypeOf(recoveredString).toEqualTypeOf<Effect.Effect<'output' | 'nf', ORPCError<string, unknown>>>()
  })

  it('types handlers of undeclared keys when the channel can hold hidden ORPCErrors', () => {
    void effectWithHidden.pipe(catchORPCErrorCodes({
      __CUSTOM__: (error) => {
        expectTypeOf(error).toExtend<AnyORPCError>()
        expectTypeOf(error.code).toExtend<string>()
        expectTypeOf(error.data).toEqualTypeOf<unknown>()
        return Effect.succeed('recovered' as const)
      },
    }))
  })

  it('narrows union codes and excludes them only once every code is handled', () => {
    const recoveredOne = effectWithUnion.pipe(catchORPCErrorCodes({
      NOT_FOUND: (error) => {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'NOT_FOUND', { id: string }>>()
        return Effect.succeed('nf' as const)
      },
    }))

    expectTypeOf(recoveredOne).toEqualTypeOf<
      Effect.Effect<'output' | 'nf', ORPCError<'NOT_FOUND' | 'CONFLICT', { id: string }>>
    >()

    const recoveredAll = effectWithUnion.pipe(catchORPCErrorCodes({
      NOT_FOUND: () => Effect.succeed('nf' as const),
      CONFLICT: (error) => {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'CONFLICT', { id: string }>>()
        return Effect.succeed('cf' as const)
      },
    }))

    expectTypeOf(recoveredAll).toEqualTypeOf<Effect.Effect<'output' | 'nf' | 'cf', never>>()
  })

  it('keeps codes whose handler can be undefined in the error channel', () => {
    const recoveredUndefined = effect.pipe(catchORPCErrorCodes({
      NOT_FOUND: undefined,
      CONFLICT: () => Effect.succeed('cf' as const),
    }))

    expectTypeOf(recoveredUndefined).toEqualTypeOf<
      Effect.Effect<'output' | 'cf', ORPCError<'NOT_FOUND', { id: string }>, Service1>
    >()

    const maybeHandler = {} as ((error: ORPCError<'NOT_FOUND', { id: string }>) => Effect.Effect<'nf', RangeError, Service2>) | undefined

    const recoveredMaybe = effect.pipe(catchORPCErrorCodes({ NOT_FOUND: maybeHandler }))

    expectTypeOf(recoveredMaybe).toEqualTypeOf<
      Effect.Effect<
        'output' | 'nf',
        ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'CONFLICT', number> | RangeError,
        Service1 | Service2
      >
    >()

    const optionalCases = {} as { NOT_FOUND?: (error: ORPCError<'NOT_FOUND', { id: string }>) => Effect.Effect<'nf'> }

    const recoveredOptional = effect.pipe(catchORPCErrorCodes(optionalCases))

    expectTypeOf(recoveredOptional).toEqualTypeOf<
      Effect.Effect<'output' | 'nf', ORPCError<'NOT_FOUND', { id: string }> | ORPCError<'CONFLICT', number>, Service1>
    >()
  })
})

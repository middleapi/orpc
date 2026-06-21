import { Cause, Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { runPromise } from './runtime'

describe('runPromise & extractErrorFromCause', () => {
  describe('success', () => {
    it('resolves with the effect value', async () => {
      const result = await runPromise(Effect.succeed(42))
      expect(result).toBe(42)
    })

    it('resolves with non-primitive values', async () => {
      const obj = { id: 1 }
      const result = await runPromise(Effect.succeed(obj))
      expect(result).toBe(obj)
    })
  })

  describe('failure - throws original error without FiberFailure wrapper', () => {
    it('interrupts the effect when the provided signal aborts', async () => {
      await expect(
        runPromise(Effect.never, { signal: AbortSignal.timeout(0) }),
      ).rejects.toThrow(/Fiber interrupted/)
    })

    it('throws the original Error instance from Effect.fail', async () => {
      const original = new TypeError('typed domain error')

      await expect(runPromise(Effect.fail(original))).rejects.toThrow(original)
    })

    it('throws the original defect from Effect.die', async () => {
      const defect = new RangeError('unexpected defect')

      await expect(runPromise(Effect.die(defect))).rejects.toThrow(defect)
    })

    it('throws the original defect from an unhandled throw inside Effect.sync', async () => {
      const defect = new SyntaxError('bad parse')
      const effect = Effect.sync(() => {
        throw defect
      })

      await expect(runPromise(effect)).rejects.toThrow(defect)
    })

    it('throws a synthesized Error on interrupt', async () => {
      const effect = Effect.gen(function* () {
        yield* Effect.interrupt
      })

      await expect(runPromise(effect)).rejects.toThrow(/Fiber interrupted/)
    })

    it('throws the finalizer error on sequential cause (mirrors try/finally)', async () => {
      const finalizerError = new Error('finalizer also failed')

      const effect = Effect.acquireUseRelease(
        Effect.succeed('resource'),
        () => Effect.fail(new Error('use failed')),
        () => Effect.fail(finalizerError) as Effect.Effect<never, never>,
      )

      await expect(runPromise(effect)).rejects.toThrow(finalizerError)
    })

    it('throws the left error on parallel cause', async () => {
      const leftError = new Error('left fiber failed')
      const rightError = new Error('right fiber failed')

      const effect = Effect.all(
        [Effect.fail(leftError), Effect.fail(rightError)],
        { concurrency: 'unbounded' },
      )

      await expect(runPromise(effect)).rejects.toThrow(leftError)
    })

    it('does NOT wrap errors in FiberFailure', async () => {
      const original = new TypeError('original')
      await expect(runPromise(Effect.fail(original))).rejects.toBe(original)
    })

    it('throws a sentinel Error when cause is empty', async () => {
      const effect = Effect.failCause(Cause.empty)

      await expect(
        runPromise(effect),
      ).rejects.toThrow(new Error('Effect failed with no error information'))
    })
  })
})

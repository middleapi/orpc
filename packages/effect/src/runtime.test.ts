import { AbortError } from '@orpc/shared'
import { Cause, Context, Effect, Option, Scheduler } from 'effect'
import { describe, expect, it, vi } from 'vitest'
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

  describe('context', () => {
    class Service1 extends Context.Service<Service1, { readonly id: 'Service1' }>()('Service1') {}

    it('runs the effect with the provided services', async () => {
      const context = Context.empty().pipe(Context.add(Service1, { id: 'Service1' }))

      await expect(runPromise(Effect.serviceOption(Service1), { context })).resolves.toEqual(Option.some({ id: 'Service1' }))
    })

    it('runs the effect with the provided scheduler', async () => {
      const scheduler = new Scheduler.MixedScheduler('sync')
      const makeDispatcher = vi.spyOn(scheduler, 'makeDispatcher')
      const context = Context.empty().pipe(Context.add(Scheduler.Scheduler, scheduler))

      await expect(runPromise(Effect.yieldNow.pipe(Effect.as(42)), { context })).resolves.toBe(42)
      expect(makeDispatcher).toHaveBeenCalled()
    })
  })

  describe('failure - throws original error without FiberFailure wrapper', () => {
    it('throws signal reason when interrupted with signal', async () => {
      const signal = AbortSignal.timeout(0)
      await expect(
        runPromise(Effect.never, { signal }),
      ).rejects.toSatisfy(e => e === signal.reason)
    })

    it('throws a generic AbortError when interrupted without signal', async () => {
      const effect = Effect.gen(function* () {
        yield* Effect.interrupt
      })

      await expect(runPromise(effect)).rejects.toThrow(new AbortError('All fibers interrupted without error'))
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

    it('throws the use error when the finalizer also fails', async () => {
      const useError = new Error('use failed')

      const effect = Effect.acquireUseRelease(
        Effect.succeed('resource'),
        () => Effect.fail(useError),
        () => Effect.fail(new Error('finalizer also failed')) as Effect.Effect<never, never>,
      )

      await expect(runPromise(effect)).rejects.toThrow(useError)
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

    it('throws a empty Error when cause is empty', async () => {
      const effect = Effect.failCause(Cause.empty)

      await expect(
        runPromise(effect),
      ).rejects.toThrow(new Error('Empty cause'))
    })
  })
})

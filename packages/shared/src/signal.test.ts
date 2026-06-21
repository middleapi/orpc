import { allAbortSignal, runWithSignal } from './signal'

describe('allAbortSignal', () => {
  it('should return undefined if contains undefined or empty array', () => {
    expect(allAbortSignal([])).toBe(undefined)
    expect(allAbortSignal([undefined])).toBe(undefined)
    expect(allAbortSignal([AbortSignal.timeout(100), undefined])).toBe(undefined)
    expect(allAbortSignal([AbortSignal.timeout(100), undefined, AbortSignal.timeout(100)])).toBe(undefined)
  })

  it('should return a non-aborted signal initially if not all inputs are aborted', () => {
    const controller1 = new AbortController()
    const controller2 = new AbortController()

    expect(allAbortSignal([controller1.signal, controller2.signal])?.aborted).toBe(false)

    controller1.abort()
    expect(allAbortSignal([controller1.signal, controller2.signal])?.aborted).toBe(false)
  })

  it('should return an aborted signal initially if all valid inputs are already aborted', () => {
    const controller1 = new AbortController()
    const controller2 = new AbortController()
    controller1.abort()
    controller2.abort()

    const batchSignal = allAbortSignal([controller1.signal, controller2.signal])
    expect(batchSignal?.aborted).toBe(true)
  })

  it('should fire abort event when all signals abort', () => {
    const controllerPreAborted = new AbortController()
    const controllerLater1 = new AbortController()
    const controllerLater2 = new AbortController()

    controllerPreAborted.abort()

    const batchSignal = allAbortSignal([
      controllerPreAborted.signal,
      controllerLater1.signal,
      controllerLater2.signal,
    ])

    expect(batchSignal?.aborted).toBe(false)

    const abortSpy = vi.fn()
    batchSignal?.addEventListener('abort', abortSpy)

    controllerLater1.abort()
    expect(batchSignal?.aborted).toBe(false)
    expect(abortSpy).not.toHaveBeenCalled()

    controllerLater2.abort()
    expect(batchSignal?.aborted).toBe(true)
    expect(abortSpy).toHaveBeenCalledTimes(1)
  })
})

describe('runWithSignal', () => {
  it('resolves with fn result when no signal provided', async () => {
    const result = await runWithSignal(undefined, async () => 42)
    expect(result).toBe(42)
  })

  it('rejects if fn rejects when no signal provided', async () => {
    await expect(runWithSignal(undefined, async () => {
      throw new Error('fail')
    }))
      .rejects
      .toThrow('fail')
  })

  it('throws immediately if signal already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already aborted'))

    const fn = vi.fn(async () => 42)
    await expect(runWithSignal(controller.signal, fn)).rejects.toThrow('already aborted')
    expect(fn).not.toHaveBeenCalled()
  })

  it('resolves with fn result when signal not aborted', async () => {
    const controller = new AbortController()
    const result = await runWithSignal(controller.signal, async () => 'success')
    expect(result).toBe('success')
  })

  it('rejects if fn rejects when signal not aborted', async () => {
    const controller = new AbortController()
    await expect(runWithSignal(controller.signal, async () => {
      throw new Error('boom')
    }))
      .rejects
      .toThrow('boom')
  })

  it('rejects when signal aborts before fn resolves', async () => {
    const controller = new AbortController()
    const fn = () => new Promise<number>(resolve => setTimeout(() => resolve(42), 1000))

    const promise = runWithSignal(controller.signal, fn)
    controller.abort(new Error('aborted mid-flight'))

    await expect(promise).rejects.toThrow('aborted mid-flight')
  })

  it('resolves if fn resolves before signal aborts', async () => {
    const controller = new AbortController()
    const fn = () => new Promise<number>(resolve => setTimeout(() => resolve(42), 10))

    const promise = runWithSignal(controller.signal, fn)
    setTimeout(() => controller.abort(new Error('too late')), 1000)

    await expect(promise).resolves.toBe(42)
  })

  it('removes abort listener after fn resolves', async () => {
    const controller = new AbortController()
    const addSpy = vi.spyOn(controller.signal, 'addEventListener')
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    await runWithSignal(controller.signal, async () => 'done')

    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('abort', addSpy.mock.calls[0]![1])
  })

  it('removes abort listener after fn rejects', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    await expect(runWithSignal(controller.signal, async () => {
      throw new Error('fail')
    }))
      .rejects
      .toThrow('fail')

    expect(removeSpy).toHaveBeenCalled()
  })
})

import { Context } from 'effect'
import { InterruptSignal, resolveInterruptSignal } from './interrupt'

describe('resolveInterruptSignal', () => {
  it('returns the request signal when no interrupt signal is provided', () => {
    const signal = new AbortController().signal

    expect(resolveInterruptSignal({}, signal)).toBe(signal)
    expect(resolveInterruptSignal({ 'effect/context': Context.empty() }, signal)).toBe(signal)
    expect(resolveInterruptSignal({ 'effect/context': 'invalid' }, undefined)).toBeUndefined()
  })

  it('aborts when either the request signal or the interrupt signal aborts', () => {
    const request = new AbortController()
    const interrupt = new AbortController()
    const context = { 'effect/context': Context.make(InterruptSignal, interrupt.signal) }

    expect(resolveInterruptSignal(context, undefined)).toBe(interrupt.signal)

    const signal1 = resolveInterruptSignal(context, request.signal)!
    expect(signal1.aborted).toBe(false)
    request.abort(new Error('__REQUEST__'))
    expect(signal1.reason).toBe(request.signal.reason)

    const signal2 = resolveInterruptSignal(context, new AbortController().signal)!
    interrupt.abort(new Error('__INTERRUPT__'))
    expect(signal2.reason).toBe(interrupt.signal.reason)
  })
})

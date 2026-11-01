import { eventIterator, oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { z } from 'zod'
import { isEventIteratorProcedure } from './utils'

describe('isEventIteratorProcedure', () => {
  it('detects an event iterator input', () => {
    expect(isEventIteratorProcedure(oc.input(eventIterator(z.string())))).toBe(true)
  })

  it('detects an event iterator output', () => {
    expect(isEventIteratorProcedure(oc.output(eventIterator(z.string(), z.number())))).toBe(true)
  })

  it('detects an event iterator among multiple schemas', () => {
    expect(isEventIteratorProcedure(oc.input(z.object({})).output(z.unknown()).output(eventIterator(z.string())))).toBe(true)
  })

  it('returns false without event iterator schemas', () => {
    expect(isEventIteratorProcedure(oc)).toBe(false)
    expect(isEventIteratorProcedure(oc.input(z.object({ id: z.number() })).output(z.string()))).toBe(false)
  })

  it('accepts implemented procedures', () => {
    expect(isEventIteratorProcedure(os.output(eventIterator(z.string())).handler(async function* () {}))).toBe(true)
    expect(isEventIteratorProcedure(os.handler(() => 'ok'))).toBe(false)
  })
})

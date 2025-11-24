import * as ServerModule from '@orpc/server'
import { expect, it, vi } from 'vitest'
import { implement } from './index'

vi.mock('@orpc/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('@orpc/server')>()
  return {
    ...original,
    implement: vi.fn(original.implement),
  }
})

it('implement is aliased', () => {
  const contract = { nested: {} }
  const options = { dedupeLeadingMiddlewares: false }
  const impl = implement(contract, options)

  expect(ServerModule.implement).toHaveBeenCalledTimes(1)
  expect(ServerModule.implement).toHaveBeenCalledWith(contract, options)
  expect(impl).toBe(vi.mocked(ServerModule.implement).mock.results[0]!.value)
})

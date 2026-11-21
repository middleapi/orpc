import { createRequestLogger } from 'evlog'

import { getEvlogLogger, EVLOG_LOGGER_CONTEXT_SYMBOL } from './context'

it('getEvlogLogger', async () => {
  expect(getEvlogLogger({})).toBeUndefined()
  expect(getEvlogLogger({ something: true } as any)).toBeUndefined()

  const logger = createRequestLogger()
  expect(getEvlogLogger({ [EVLOG_LOGGER_CONTEXT_SYMBOL]: logger })).toBe(logger)
})

it('deprecated aliases', async () => {
  const context = await import('./context')

  expect(context.LOGGER_CONTEXT_SYMBOL).toBe(context.EVLOG_LOGGER_CONTEXT_SYMBOL)
  expect(context.getLogger).toBe(context.getEvlogLogger)
})

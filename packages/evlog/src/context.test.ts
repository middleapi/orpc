import { createRequestLogger } from 'evlog'

import { getEvlogLogger, EVLOG_LOGGER_CONTEXT_SYMBOL } from './context'

it('getEvlogLogger', async () => {
  expect(getEvlogLogger({})).toBeUndefined()
  expect(getEvlogLogger({ something: true } as any)).toBeUndefined()

  const logger = createRequestLogger()
  expect(getEvlogLogger({ [EVLOG_LOGGER_CONTEXT_SYMBOL]: logger })).toBe(logger)
})

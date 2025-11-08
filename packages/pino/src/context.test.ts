import pino from 'pino'
import { CONTEXT_LOGGER_SYMBOL, getLogger } from './context'

it('getLogger', async () => {
  expect(getLogger({})).toBeUndefined()
  expect(getLogger({ something: true })).toBeUndefined()

  const logger = pino()
  expect(getLogger({ [CONTEXT_LOGGER_SYMBOL]: logger })).toBe(logger)
})

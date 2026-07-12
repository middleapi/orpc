import pino from 'pino'
import { PINO_HANDLER_PLUGIN_CONTEXT_SYMBOL } from './handler-plugin'
import { getLogger } from './utils'

it('getLogger', async () => {
  expect(getLogger({})).toBeUndefined()
  expect(getLogger({ something: true } as any)).toBeUndefined()

  const logger = pino()
  expect(getLogger({ [PINO_HANDLER_PLUGIN_CONTEXT_SYMBOL]: { logger } })).toBe(logger)
})

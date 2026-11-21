import pino from 'pino'

import { getPinoLogger, PINO_LOGGER_CONTEXT_SYMBOL } from './context'

it('getPinoLogger', async () => {
  expect(getPinoLogger({})).toBeUndefined()
  expect(getPinoLogger({ something: true } as any)).toBeUndefined()

  const logger = pino()
  expect(getPinoLogger({ [PINO_LOGGER_CONTEXT_SYMBOL]: logger })).toBe(logger)
})

it('deprecated aliases', async () => {
  const context = await import('./context')

  expect(context.LOGGER_CONTEXT_SYMBOL).toBe(context.PINO_LOGGER_CONTEXT_SYMBOL)
  expect(context.getLogger).toBe(context.getPinoLogger)
})

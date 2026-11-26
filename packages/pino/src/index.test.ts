it('exports PinoHandlerPlugin', async () => {
  expect(Object.keys(await import('./index'))).toContain('PinoHandlerPlugin')
})

it('exports deprecated aliases', async () => {
  const index = await import('./index')

  expect(index.LOGGER_CONTEXT_SYMBOL).toBe(index.PINO_LOGGER_CONTEXT_SYMBOL)
  expect(index.getLogger).toBe(index.getPinoLogger)
})

it('exports EvlogHandlerPlugin', async () => {
  expect(Object.keys(await import('./index'))).toContain('EvlogHandlerPlugin')
})

it('exports deprecated aliases', async () => {
  const index = await import('./index')

  expect(index.LOGGER_CONTEXT_SYMBOL).toBe(index.EVLOG_LOGGER_CONTEXT_SYMBOL)
  expect(index.getLogger).toBe(index.getEvlogLogger)
})

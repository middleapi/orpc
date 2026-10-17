it('exports BetterAuthHandlerPlugin and session middlewares', async () => {
  expect(Object.keys(await import('./index'))).toEqual(expect.arrayContaining([
    'BETTER_AUTH_CONTEXT_SYMBOL',
    'BetterAuthHandlerPlugin',
    'createBetterAuthContext',
    'optionalSession',
    'requireSession',
  ]))
})

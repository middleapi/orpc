it('exports session middlewares', async () => {
  expect(Object.keys(await import('./index'))).toEqual(expect.arrayContaining([
    'optionalSession',
    'requireSession',
  ]))
})

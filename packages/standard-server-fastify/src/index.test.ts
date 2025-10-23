it('exports toStandardLazyRequest', async () => {
  expect(Object.keys(await import('./index'))).toContain('toStandardLazyRequest')
})

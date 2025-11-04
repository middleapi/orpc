it('exports Publisher', async () => {
  expect(Object.keys(await import('./index'))).toContain('Publisher')
})

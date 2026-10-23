it('exports somethings', async () => {
  await expect(import('.')).resolves.toMatchObject({
    allAbortSignal: expect.any(Function),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('.')

  expect(mod).not.toHaveProperty('AsyncIdQueue')
  expect(mod).not.toHaveProperty('runInSpanContext')
  expect(mod).not.toHaveProperty('setSpanAttributeIfDefined')
  expect(mod).not.toHaveProperty('startSpan')
})

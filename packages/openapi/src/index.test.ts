it('exports openapi meta, OpenAPIGenerator, OpenAPISerializer, OpenAPIJsonSerializer, BracketNotationSerializer', async () => {
  await expect(import('.')).resolves.toMatchObject({
    openapi: expect.any(Function),
    OpenAPIGenerator: expect.any(Function),
    OpenAPISerializer: expect.any(Function),
    OpenAPIJsonSerializer: expect.any(Function),
    BracketNotationSerializer: expect.any(Function),
  })
})

it('does not export internal helpers', async () => {
  const mod = await import('.')

  expect(mod).not.toHaveProperty('DEFAULT_OPENAPI_INPUT_STRUCTURE')
  expect(mod).not.toHaveProperty('DEFAULT_OPENAPI_OUTPUT_STRUCTURE')
  expect(mod).not.toHaveProperty('DEFAULT_OPENAPI_SUCCESS_DESCRIPTION')
  expect(mod).not.toHaveProperty('isBodylessMethod')
})

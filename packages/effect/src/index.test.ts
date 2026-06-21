it('exports EffectSchemaToJsonSchemaConverter, handlerGen, toStandardSchema', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    handlerGen: expect.any(Function),
    EffectSchemaToJsonSchemaConverter: expect.any(Function),
    toStandardSchema: expect.any(Function),
  })
})

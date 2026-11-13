it('exports OpenAPIGenerator, openTypeScriptProject, TypeToJsonSchemaConverter, and no generator internals', async () => {
  const exported = await import('./index')

  expect(Object.keys(exported).toSorted()).toEqual([
    'OpenAPIGenerator',
    'TypeScriptTypeResolutionError',
    'TypeToJsonSchemaConverter',
    'openTypeScriptProject',
  ])
})

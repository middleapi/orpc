it('exports McpRegistrar and mcp', async () => {
  expect(Object.keys(await import('./index.ts'))).toEqual(
    expect.arrayContaining(['McpRegistrar', 'mcp', 'getMcpToolMeta']),
  )
})

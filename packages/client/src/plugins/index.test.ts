it('exports BatchLinkPlugin, BatchLinkPluginError, DedupeLinkPlugin, RetryLinkPlugin, RetryAfterLinkPlugin', async () => {
  await expect(import('./index')).resolves.toMatchObject({
    BatchLinkPlugin: expect.any(Function),
    DedupeLinkPlugin: expect.any(Function),
    RetryLinkPlugin: expect.any(Function),
    RetryAfterLinkPlugin: expect.any(Function),
  })
})

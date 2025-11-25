vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(protected readonly ctx: any, protected readonly env: unknown) {}
  },
}))

it('exports PublisherDurableObject', async () => {
  expect(Object.keys(await import('./index'))).toContain('PublisherDurableObject')
})

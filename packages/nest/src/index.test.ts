import { expect, it } from 'vitest'

it('exports ORPCModule, Impl, Implement', async () => {
  await expect(import('../src/index.ts')).resolves.toMatchObject({
    ORPCModule: expect.any(Function),
    Impl: expect.any(Function),
    Implement: expect.any(Function),
  })
})

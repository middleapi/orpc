import { expect, it } from 'vitest'

it('exports', async () => {
  await expect(import('./index')).resolves.toMatchObject({
  })
})

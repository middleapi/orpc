import { MemoryLock } from './lock'

describe('memoryLock', () => {
  it('runs callbacks one key at a time, in order, telling later callers they waited', async () => {
    const lock = new MemoryLock()
    const order: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = lock.run('k', async (waited) => {
      order.push(`first:${waited}`)
      await held
      return 'first'
    })
    const second = lock.run('k', async (waited) => {
      order.push(`second:${waited}`)
      return 'second'
    })
    const third = lock.run('k', async (waited) => {
      order.push(`third:${waited}`)
      return 'third'
    })

    // Other keys are independent of the held one.
    await expect(lock.run('other', async waited => waited)).resolves.toBe(false)
    expect(order).toEqual(['first:false'])

    release()

    await expect(Promise.all([first, second, third])).resolves.toEqual(['first', 'second', 'third'])
    expect(order).toEqual(['first:false', 'second:true', 'third:true'])
  })

  it('hands the turn on when a callback throws, and frees the key afterwards', async () => {
    const lock = new MemoryLock()
    let fail!: (error: Error) => void

    const first = lock.run('k', () => new Promise<never>((_, reject) => {
      fail = reject
    }))
    const second = lock.run('k', async waited => waited)

    fail(new Error('boom'))

    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe(true)
    await expect(lock.run('k', async waited => waited)).resolves.toBe(false)
  })
})

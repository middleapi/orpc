import { promiseWithResolvers } from '@orpc/shared'
import { effectScope, watch } from 'vue'

import { createChunkController, createQueryCache, mountQuery } from '../tests/__shared__/utils.ts'
import { liveQuery } from './live-query.ts'

describe('liveQuery', () => {
  it('publishes each chunk to the cache, replacing the previous value', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(() => controller.stream()),
    })

    controller.push(1)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(1), { interval: 1 })
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.push(2)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(2), { interval: 1 })
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    expect(mounted.vm.query.data.value).toEqual(2)
    expect(mounted.vm.query.status.value).toEqual('success')
    expect(mounted.vm.queryCache.getQueryData(['live'])).toEqual(2)
  })

  it('keeps data written to the entry after the last event', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(() => controller.stream()),
    })

    controller.push(1)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(1), { interval: 1 })

    mounted.vm.queryCache.setQueryData(['live'], 2)

    controller.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    expect(mounted.vm.query.data.value).toEqual(2)
    expect(mounted.vm.query.status.value).toEqual('success')
  })

  it('errors when the stream yields no chunks', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(() => controller.stream()),
    })

    controller.close()

    await vi.waitFor(() => expect(mounted.vm.query.error.value).toBeInstanceOf(TypeError), {
      interval: 1,
    })
    expect((mounted.vm.query.error.value as any).message).toContain('did not yield any data')
    expect(mounted.vm.query.status.value).toEqual('error')
  })

  it('stops streaming when the query is cancelled', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(() => controller.stream()),
    })

    controller.push(1)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(1), { interval: 1 })

    mounted.vm.queryCache.cancelQueries({ key: ['live'] }, new Error('__cancelled__'))
    controller.push(2) // resumes the stream loop, which now observes the aborted signal

    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })
    expect(mounted.vm.query.data.value).toEqual(1)
    expect(mounted.vm.query.error.value).toBeNull()
  })

  it('keeps existing data until the first event on refetch', async () => {
    const first = createChunkController<number>()
    const second = createChunkController<number>()

    const queryFn = vi
      .fn()
      .mockImplementationOnce(() => first.stream())
      .mockImplementationOnce(() => second.stream())

    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(queryFn),
    })

    first.push(1)
    first.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'), {
      interval: 1,
    })

    const statuses: string[] = []
    watch(
      () => mounted.vm.query.status.value,
      (status) => statuses.push(status),
      { flush: 'sync' },
    )

    const refetching = mounted.vm.query.refetch()

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2), { interval: 1 })
    expect(mounted.vm.query.data.value).toEqual(1)
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    second.push(2)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(2), { interval: 1 })

    second.close()
    await refetching
    expect(statuses).not.toContain('pending')
  })

  it('settles a fetch with no component at the first event with settleOnFirstData: true', async () => {
    const cleanup = vi.fn()
    const queryCache = createQueryCache()

    const entry = queryCache.ensure({
      key: ['live'],
      query: liveQuery(
        async () =>
          (async function* () {
            try {
              yield 1
              await new Promise(() => {})
            } finally {
              cleanup()
            }
          })(),
        { settleOnFirstData: true },
      ),
    })

    await expect(queryCache.fetch(entry)).resolves.toEqual({
      status: 'success',
      data: 1,
      error: null,
    })
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(entry.asyncStatus.value).toEqual('idle')
  })

  it('closes the stream without starting it and marks the entry stale when aborted before it connects', async () => {
    const controller = new AbortController()
    const started = vi.fn()
    const entry = {
      key: ['live'],
      when: 1,
      state: { value: { status: 'success', data: 0, error: null } },
    }

    const fetching = liveQuery(async () => {
      controller.abort()
      return (async function* () {
        started()
        yield 1
      })()
    })({ entry, signal: controller.signal } as any)

    await expect(fetching).rejects.toBe(controller.signal.reason)
    expect(started).not.toHaveBeenCalled()
    expect(entry).toMatchObject({ when: 0, state: { value: { data: 0 } } })
  })
})

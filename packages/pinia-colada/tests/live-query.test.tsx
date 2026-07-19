import { liveQuery } from '../src/live-query'
import { createChunkController, mountQuery } from './__shared__/query'

describe('liveQuery', () => {
  it('publishes each chunk to the cache, replacing the previous value', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(() => controller.stream()),
    })

    controller.push(1)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(1))
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.push(2)
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(2))
    expect(mounted.vm.query.asyncStatus.value).toEqual('loading')

    controller.close()
    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'))
    expect(mounted.vm.query.data.value).toEqual(2)
    expect(mounted.vm.query.status.value).toEqual('success')
    expect(mounted.vm.queryCache.getQueryData(['live'])).toEqual(2)
  })

  it('errors when the stream yields no chunks', async () => {
    const controller = createChunkController<number>()
    const mounted = mountQuery({
      key: ['live'],
      query: liveQuery(() => controller.stream()),
    })

    controller.close()

    await vi.waitFor(() => expect(mounted.vm.query.error.value).toBeInstanceOf(TypeError))
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
    await vi.waitFor(() => expect(mounted.vm.query.data.value).toEqual(1))

    mounted.vm.queryCache.cancelQueries({ key: ['live'] }, new Error('__cancelled__'))
    controller.push(2) // resumes the stream loop, which now observes the aborted signal

    await vi.waitFor(() => expect(mounted.vm.query.asyncStatus.value).toEqual('idle'))
    expect(mounted.vm.query.data.value).toEqual(1)
    expect(mounted.vm.query.error.value).toBeNull()
  })
})

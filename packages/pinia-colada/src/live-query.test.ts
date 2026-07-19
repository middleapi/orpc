import { liveQuery } from './live-query'

function createContext(signal: AbortSignal = new AbortController().signal) {
  return {
    entry: {
      state: { value: { status: 'pending', data: undefined, error: null } },
      key: ['test'],
    },
    signal,
  } as any
}

async function* chunks<T>(...values: T[]) {
  for (const value of values) {
    yield value
  }
}

describe('liveQuery', () => {
  it('publishes each chunk to the entry and returns the last one', async () => {
    const context = createContext()
    const published: unknown[] = []
    context.entry.state = new Proxy(context.entry.state, {
      set(target, prop, value) {
        if (prop === 'value') {
          published.push(value)
        }
        return Reflect.set(target, prop, value)
      },
    })

    await expect(liveQuery(() => chunks(1, 2, 3))(context)).resolves.toEqual(3)
    expect(published).toEqual([
      { status: 'success', data: 1, error: null },
      { status: 'success', data: 2, error: null },
      { status: 'success', data: 3, error: null },
    ])
  })

  it('throws when the stream yields no chunks', async () => {
    await expect(liveQuery(() => chunks())(createContext())).rejects.toThrow(
      'did not yield any data',
    )
  })

  it('throws abort reason when signal is aborted mid-stream', async () => {
    const controller = new AbortController()

    const query = liveQuery(async function* () {
      yield 1
      controller.abort(new Error('__aborted__'))
      yield 2
    })

    await expect(query(createContext(controller.signal))).rejects.toThrow('__aborted__')
  })
})

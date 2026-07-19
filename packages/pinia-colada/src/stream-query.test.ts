import { serializableStreamedQuery } from './stream-query'

function createEntry(data?: unknown) {
  return {
    state: {
      value: data === undefined
        ? { status: 'pending', data: undefined, error: null }
        : { status: 'success', data, error: null },
    },
    key: ['test'],
  } as any
}

function createContext(entry: any, signal: AbortSignal = new AbortController().signal) {
  return { entry, signal } as any
}

async function* chunks<T>(...values: T[]) {
  for (const value of values) {
    yield value
  }
}

describe('serializableStreamedQuery', () => {
  it('accumulates chunks and publishes each one to the entry', async () => {
    const entry = createEntry()
    const published: unknown[] = []
    entry.state = new Proxy(entry.state, {
      set(target, prop, value) {
        if (prop === 'value') {
          published.push(value)
        }
        return Reflect.set(target, prop, value)
      },
    })

    const query = serializableStreamedQuery(() => chunks(1, 2, 3))

    await expect(query(createContext(entry))).resolves.toEqual([1, 2, 3])
    expect(published).toEqual([
      { status: 'success', data: [], error: null },
      { status: 'success', data: [1], error: null },
      { status: 'success', data: [1, 2], error: null },
      { status: 'success', data: [1, 2, 3], error: null },
    ])
  })

  it('resets previous data to pending by default on refetch', async () => {
    const entry = createEntry(['old'])
    const query = serializableStreamedQuery(() => chunks('a', 'b'))

    const promise = query(createContext(entry))

    await expect(promise).resolves.toEqual(['a', 'b'])
    expect(entry.state.value).toEqual({ status: 'success', data: ['a', 'b'], error: null })
  })

  it('appends to previous data with refetchMode=append', async () => {
    const entry = createEntry(['old'])
    const query = serializableStreamedQuery(() => chunks('a'), { refetchMode: 'append' })

    await expect(query(createContext(entry))).resolves.toEqual(['old', 'a'])
    expect(entry.state.value).toEqual({ status: 'success', data: ['old', 'a'], error: null })
  })

  it('buffers and replaces with refetchMode=replace', async () => {
    const entry = createEntry(['old'])
    const query = serializableStreamedQuery(() => chunks('a', 'b'), { refetchMode: 'replace' })

    await expect(query(createContext(entry))).resolves.toEqual(['a', 'b'])
    // entry is untouched during the stream, final value comes from the fetch resolution
    expect(entry.state.value).toEqual({ status: 'success', data: ['old'], error: null })
  })

  it('updates cache during stream on first fetch even with refetchMode=replace', async () => {
    const entry = createEntry()
    const query = serializableStreamedQuery(() => chunks('a'), { refetchMode: 'replace' })

    await expect(query(createContext(entry))).resolves.toEqual(['a'])
    expect(entry.state.value).toEqual({ status: 'success', data: ['a'], error: null })
  })

  it('limits chunks with maxChunks', async () => {
    const entry = createEntry(['old1', 'old2'])
    const query = serializableStreamedQuery(() => chunks('a', 'b'), { refetchMode: 'append', maxChunks: 2 })

    await expect(query(createContext(entry))).resolves.toEqual(['a', 'b'])
    expect(entry.state.value).toEqual({ status: 'success', data: ['a', 'b'], error: null })
  })

  it('throws abort reason when signal is aborted mid-stream', async () => {
    const entry = createEntry()
    const controller = new AbortController()

    const query = serializableStreamedQuery(async function* () {
      yield 1
      controller.abort(new Error('__aborted__'))
      yield 2
    })

    await expect(query(createContext(entry, controller.signal))).rejects.toThrow('__aborted__')
    expect(entry.state.value).toEqual({ status: 'success', data: [1], error: null })
  })
})

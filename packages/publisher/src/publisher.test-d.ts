import type { Publisher } from './publisher.ts'

describe('publisher', () => {
  it('key-value types', async () => {
    const pub = {} as Publisher<{
      'event-1': {
        id: string
      }
      'event-2': {
        name: string
      }
    }>

    void pub.publish('event-1', { id: '1' })
    void pub.publish('event-2', { name: '1' })
    // @ts-expect-error - wrong event
    void pub.publish('event-3', { name: '1' })
    // @ts-expect-error - wrong payload
    void pub.publish('event-2', { name: 123 })

    void pub.subscribe('event-1', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{
        id: string
      }>()
    })

    void pub.subscribe('event-2', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{
        name: string
      }>()
    })

    // @ts-expect-error - wrong event
    void pub.subscribe('event-3', (payload) => {})

    for await (const payload of pub.subscribe('event-1')) {
      expectTypeOf(payload).toEqualTypeOf<{
        id: string
      }>()
    }

    for await (const payload of pub.subscribe('event-2')) {
      expectTypeOf(payload).toEqualTypeOf<{
        name: string
      }>()
    }

    // @ts-expect-error - wrong event
    for await (const payload of pub.subscribe('event-3')) {
      // empty
    }
  })

  it('record types', async () => {
    const pub = {} as Publisher<Record<string, { id: string }>>

    void pub.publish('event-1', { id: '1' })
    void pub.publish('event-2', { id: '1' })
    void pub.publish('event-100', { id: '1' })
    // @ts-expect-error - invalid payload
    void pub.publish('event-100', { id: 123 })

    void pub.subscribe('event-933', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{
        id: string
      }>()
    })

    for await (const payload of pub.subscribe('event-3439')) {
      expectTypeOf(payload).toEqualTypeOf<{
        id: string
      }>()
    }
  })
})

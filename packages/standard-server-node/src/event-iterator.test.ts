import { Readable } from 'node:stream'
import { isAsyncIteratorObject } from '@orpc/shared'
import { toEventIterator, toEventStream } from './event-iterator'

it('toEventIterator', async () => {
  const stream = new ReadableStream<string>({
    async pull(controller) {
      controller.enqueue('event: message\ndata: 1\n\n')
      controller.enqueue('event: message\ndata: 2\n\n')
      controller.enqueue('event: message\ndata: 3\n\n')
      controller.close()
    },
  }).pipeThrough(new TextEncoderStream())

  const generator = toEventIterator(Readable.fromWeb(stream))
  expect(generator).toSatisfy(isAsyncIteratorObject)

  expect(await generator.next()).toEqual({ done: false, value: 1 })
  expect(await generator.next()).toEqual({ done: false, value: 2 })
  expect(await generator.next()).toEqual({ done: false, value: 3 })
  expect(await generator.next()).toEqual({ done: true, value: undefined })
})

it('toEventStream', async () => {
  async function* gen() {
    yield 1
    yield 2
    yield 3
  }

  const reader = Readable.toWeb(toEventStream(gen(), {}))
    .pipeThrough(new TextDecoderStream())
    .getReader()

  expect((await reader.read())).toEqual({ done: false, value: ': \n\n' })
  expect((await reader.read())).toEqual({ done: false, value: 'event: message\ndata: 1\n\n' })
  expect((await reader.read())).toEqual({ done: false, value: 'event: message\ndata: 2\n\n' })
  expect((await reader.read())).toEqual({ done: false, value: 'event: message\ndata: 3\n\n' })
  expect((await reader.read())).toEqual({ done: true, value: undefined })
})

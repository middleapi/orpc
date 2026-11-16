import { os, type } from '@orpc/server'

const stream = (): ReadableStream<string> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue('a')
      controller.close()
    },
  })

const form = (): FormData => {
  const data = new FormData()
  data.append('a', 'b')
  return data
}

class Upload extends ReadableStream<Uint8Array> {}

// oRPC sends a whole body of these as is, a stream as binary data, not as an event stream
export const bodyBuiltins = {
  streamBody: os.handler((): ReadableStream<string> => stream()),
  maybeStreamBody: os.handler((): ReadableStream<string> | null => stream()),
  uploadBody: os.handler((): Upload => new Upload()),
  formBody: os.handler((): FormData => form()),
  readonlyFormBody: os.handler((): Readonly<FormData> => form()),
  paramsBody: os.handler((): URLSearchParams => new URLSearchParams('a=1')),
  streamInput: os.input(type<ReadableStream<string>>()).handler(() => 1),
  formInput: os.input(type<FormData | null>()).handler(() => 1),
  paramsInput: os.input(type<URLSearchParams>()).handler(() => 1),
  // a client sends a promise as is, written as `{}`, not the value it resolves to
  promiseInput: os.input(type<Promise<number> | null>()).handler(() => 1),
  // inside a body, they are written by `JSON.stringify`, as `{}`
  heldBodies: os.handler((): { s: ReadableStream<string>; f: FormData; p: URLSearchParams } => ({
    s: stream(),
    f: form(),
    p: new URLSearchParams('a=1'),
  })),
}

export const bodyBuiltinsInputs: Record<string, () => unknown> = {
  streamInput: stream,
  formInput: form,
  paramsInput: () => new URLSearchParams('a=1'),
}

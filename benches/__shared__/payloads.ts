import { isAsyncIteratorObject } from '@standardserver/shared'

class Person {
  constructor(
    public name: string,
    public age: number,
  ) {}
}

export const handlers = {
  person: {
    condition: (value: unknown) => value instanceof Person,
    serialize: (person: Person) => ({ name: person.name, age: person.age }),
    deserialize: (data: { name: string, age: number }) => new Person(data.name, data.age),
  },
}

/** Mix of native types + custom Person class. */
function createUnit(i: number) {
  return {
    id: i,
    name: `item-${i}`,
    active: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    largeInt: 9007199254740993n + BigInt(i),
    tags: new Set(['a', 'b', 'c']),
    metadata: new Map<string, unknown>([
      ['version', '2.0.0'],
      ['count', i],
      ['nested', new Date('2023-06-15T12:30:00.000Z')],
    ]),
    homepage: new URL('https://orpc.dev/docs'),
    pattern: /^[a-z0-9-]+$/i,
    person: new Person(`person-${i}`, 20 + (i % 50)),
  }
}

const SIZE_1KB = 1024
const SIZE_100KB = 100 * SIZE_1KB
const SIZE_5MB = 5 * 1024 * 1024

export const PAYLOAD_1KB = createUnit(0)
export const PAYLOAD_100KB = Array.from({ length: 100 }, (_, i) => createUnit(i))
export const PAYLOAD_5MB = Array.from({ length: 5_000 }, (_, i) => createUnit(i))
// 3/10 JSON (native types + Person), 7/10 files
const FILE_BYTES = Math.floor(SIZE_5MB * 7 / 10 / 4)
export const PAYLOAD_5MB_WITH_FILES = {
  items: Array.from({ length: 1_500 }, (_, i) => createUnit(i)),
  files: [
    new File([new Uint8Array(FILE_BYTES)], 'a.bin'),
    new File([new Uint8Array(FILE_BYTES)], 'b.bin'),
    new File([new Uint8Array(FILE_BYTES)], 'c.bin'),
    new File([new Uint8Array(FILE_BYTES)], 'd.bin'),
  ],
}

export const cases = [
  ['1KB', PAYLOAD_1KB],
  ['100KB', PAYLOAD_100KB],
  ['5MB', PAYLOAD_5MB],
  ['5MB with files', PAYLOAD_5MB_WITH_FILES],
] as const

/** Event parts: each entry is one SSE event (reuses structured units). */
export const eventCases = [
  ['1KB', [PAYLOAD_1KB]],
  ['100KB', Array.from({ length: 50 }).fill([PAYLOAD_1KB, PAYLOAD_1KB])],
  ['5MB', Array.from({ length: 1000 }).fill([PAYLOAD_1KB, PAYLOAD_1KB, PAYLOAD_1KB, PAYLOAD_1KB, PAYLOAD_1KB])],
] as const

function splitBytes(size: number, parts: number): Uint8Array[] {
  const buf = new Uint8Array(size)
  const base = Math.floor(size / parts)
  let rem = size - base * parts
  const out: Uint8Array[] = []
  let off = 0
  for (let i = 0; i < parts; i++) {
    const n = base + (rem-- > 0 ? 1 : 0)
    out.push(buf.subarray(off, off + n))
    off += n
  }
  return out
}

/** Octet parts: chunked binary buffers totaling the labeled size. */
export const octetCases = [
  ['1KB', splitBytes(SIZE_1KB, 1)],
  ['100KB', splitBytes(SIZE_100KB, 50)],
  ['5MB', splitBytes(SIZE_5MB, 1000)],
] as const

/** Fresh async generator over prebuilt event parts (one-shot per call). */
export function asEventStream(parts: readonly unknown[]): AsyncGenerator<unknown, void, undefined> {
  return (async function* () {
    for (const part of parts) {
      yield part
    }
  }())
}

/** Fresh ReadableStream over prebuilt octet chunks (one-shot per call). */
export function asOctetStream(parts: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= parts.length) {
        controller.close()
      }
      else {
        controller.enqueue(parts[i++]!)
      }
    },
  })
}

export async function drainBody(body: unknown): Promise<void> {
  if (body === undefined || body === null) {
    return
  }

  if (isAsyncIteratorObject(body)) {
    const iterator = body as AsyncGenerator
    while (true) {
      const result = await iterator.next()
      if (result.done) {
        break
      }
    }
    return
  }

  if (body instanceof ReadableStream) {
    const reader = body.getReader()
    try {
      while (true) {
        const { done } = await reader.read()
        if (done) {
          break
        }
      }
    }
    finally {
      reader.releaseLock()
    }
  }
}

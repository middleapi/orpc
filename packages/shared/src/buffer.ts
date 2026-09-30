import type { Arrayable } from 'type-fest'

/**
 * Load Request/Response/Blob/File/.. to a buffer (Uint8Array<ArrayBuffer>).
 *
 * Prefers the newer `.bytes` method when available as it more efficient but not widely supported yet.
 */
export async function loadBytes(source: Pick<Blob, 'arrayBuffer' | 'bytes'>): ReturnType<Blob['bytes']> {
  if (typeof source.bytes === 'function') {
    // eslint-disable-next-line ban/ban
    return source.bytes()
  }

  return new Uint8Array(await (source as Pick<Blob, 'arrayBuffer'>).arrayBuffer())
}

/**
 * Normalize text or binary-like inputs to either:
 * - the original string value, or
 * - a Uint8Array view over the source bytes.
 */
export function toStringOrBytes(source: Arrayable<string | ArrayBuffer | Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'>>): string | Awaited<ReturnType<Blob['bytes']>> {
  if (typeof source === 'string') {
    return source
  }

  if (Array.isArray(source)) {
    return concatBytes(source)
  }

  return toBytes(source)
}

function toBytes(item: string | ArrayBuffer | Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'>): Awaited<ReturnType<Blob['bytes']>> {
  if (typeof item === 'string') {
    return new TextEncoder().encode(item)
  }

  if (isArrayBufferLike(item)) {
    return new Uint8Array(item)
  }

  if (item instanceof Uint8Array) {
    return item as Awaited<ReturnType<Blob['bytes']>>
  }

  return new Uint8Array(item.buffer, item.byteOffset, item.byteLength)
}

/**
 * Matches an ArrayBuffer or SharedArrayBuffer, including ones from other realms
 * that fail `instanceof ArrayBuffer`.
 */
function isArrayBufferLike(value: object): value is ArrayBuffer {
  if (ArrayBuffer.isView(value)) {
    return false
  }

  const tag = Object.prototype.toString.call(value)
  return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]'
}

function concatBytes(items: Array<string | ArrayBuffer | Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'>>): Uint8Array<ArrayBuffer> {
  const chunks = items.map(toBytes)
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)

  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result
}

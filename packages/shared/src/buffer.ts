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

  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source)
  }

  if (Array.isArray(source)) {
    return concatBytes(source)
  }

  if (source instanceof Uint8Array) {
    return source as Awaited<ReturnType<Blob['bytes']>>
  }

  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
}

function toBytes(item: string | ArrayBuffer | Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'>): Awaited<ReturnType<Blob['bytes']>> {
  if (typeof item === 'string') {
    return new TextEncoder().encode(item)
  }

  if (item instanceof ArrayBuffer) {
    return new Uint8Array(item)
  }

  if (item instanceof Uint8Array) {
    return item as Awaited<ReturnType<Blob['bytes']>>
  }

  return new Uint8Array(item.buffer, item.byteOffset, item.byteLength)
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

interface NodeBuiltinModulesGlobal {
  process?: {
    getBuiltinModule?: (id: 'node:buffer') => {
      Buffer: { from: (buffer: ArrayBufferLike, byteOffset: number, length: number) => { toString: (encoding: 'base64') => string } }
    } | undefined
  }
}

/**
 * Encodes bytes to standard, padded base64, as data URLs and many protocols require.
 * Prefers the native `toBase64` or `Buffer`, which are far faster for large outputs.
 */
export function encodeBase64(bytes: Uint8Array): string {
  const native = bytes as Uint8Array & { toBase64?: () => string }

  if (typeof native.toBase64 === 'function') {
    return native.toBase64()
  }

  // loaded at runtime, so the package keeps working on runtimes without Node.js built-ins
  // eslint-disable-next-line node/prefer-global/process
  const NodeBuffer = (globalThis as NodeBuiltinModulesGlobal).process?.getBuiltinModule?.('node:buffer')?.Buffer

  if (NodeBuffer !== undefined) {
    return NodeBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  }

  const chunkSize = 8192 // 8KB chunks to stay well below call stack limits
  let binaryString = ''

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binaryString += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  return btoa(binaryString)
}

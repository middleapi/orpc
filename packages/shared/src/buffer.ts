/**
 * Load Request/Response/Blob/File/.. to a buffer (Uint8Array<ArrayBuffer>).
 *
 * Prefers the newer `.bytes` method when available as it more efficient but not widely supported yet.
 */
export async function loadBytes(source: Pick<Blob, 'arrayBuffer' | 'bytes'>): Promise<Uint8Array<ArrayBuffer>> {
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
export async function toStringOrBytes(source: string | ArrayBuffer | Blob | Exclude<ConstructorParameters<typeof Blob>[0], undefined>[0][] | Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'>): Promise<string | Uint8Array<ArrayBuffer>> {
  if (typeof source === 'string') {
    return source
  }

  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source)
  }

  if (source instanceof Blob) {
    return loadBytes(source)
  }

  if (Array.isArray(source)) {
    return loadBytes(new Blob(source))
  }

  if (source instanceof Uint8Array) {
    return source as Uint8Array<ArrayBuffer>
  }

  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
}

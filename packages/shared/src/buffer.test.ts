import { loadBytes, toStringOrBytes } from './buffer'

it('loadBytes', async () => {
  const blob = new Blob(['test'], { type: 'text/plain' })

  expect(new TextDecoder().decode(await loadBytes(blob))).toBe('test')
  expect(new TextDecoder().decode(await loadBytes(new Proxy(blob, {
    get: (target, prop) => {
      if (prop === 'bytes') {
        return undefined
      }
      return Reflect.get(target, prop)
    },
  })))).toBe('test')

  expect(new TextDecoder().decode(await loadBytes((new Response(blob) as any)))).toBe('test')
})

describe('toStringOrBytes', () => {
  it('string passthrough', async () => {
    expect(await toStringOrBytes('test')).toBe('test')
  })

  it('arrayBuffer', async () => {
    const input = new TextEncoder().encode('test').buffer
    const result = await toStringOrBytes(input)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('test')
  })

  it('blob', async () => {
    const blob = new Blob(['test'], { type: 'text/plain' })
    const result = await toStringOrBytes(blob)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('test')
  })

  it('blobPart[]', async () => {
    const result = await toStringOrBytes(['te', 'st'])
    expect(result).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('test')
  })

  it('uint8Array passthrough', async () => {
    const input = new Uint8Array([0, 1, 2, 3])
    const result = await toStringOrBytes(input)
    expect(result).toBe(input) // should be the same instance
  })

  it('uint8Array view-like input', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]).subarray(1, 3)
    const input: Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'> = { buffer: bytes.buffer, byteOffset: bytes.byteOffset, byteLength: bytes.byteLength }

    const result = await toStringOrBytes(input)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result).not.toBe(bytes) // should be a different view, not the original input
    expect(result).toEqual(bytes)
  })
})

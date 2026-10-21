import { Buffer } from 'node:buffer'
import process from 'node:process'
import { encodeBase64, loadBytes, toStringOrBytes } from './buffer'

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
  it('string passthrough', () => {
    expect(toStringOrBytes('test')).toBe('test')
  })

  it('arrayBuffer', () => {
    const input = new TextEncoder().encode('test').buffer
    const result = toStringOrBytes(input)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('test')
  })

  it('uint8Array passthrough', () => {
    const input = new Uint8Array([0, 1, 2, 3])
    const result = toStringOrBytes(input)
    expect(result).toBe(input) // should be the same instance
  })

  it('uint8Array view-like input', () => {
    const bytes = new Uint8Array([0, 1, 2, 3]).subarray(1, 3)
    const input: Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'> = {
      buffer: bytes.buffer,
      byteOffset: bytes.byteOffset,
      byteLength: bytes.byteLength,
    }

    const result = toStringOrBytes(input)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result).not.toBe(bytes) // should be a different view, not the original input
    expect(result).toEqual(bytes)
  })

  describe('array input', () => {
    it('all-string array concatenates to bytes (UTF-8 encoded)', () => {
      const result = toStringOrBytes(['te', 'st'])
      expect(result).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(result as Uint8Array)).toBe('test')
    })

    it('single-string array concatenates to bytes', () => {
      const result = toStringOrBytes(['solo'])
      expect(result).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(result as Uint8Array)).toBe('solo')
    })

    it('empty array returns empty Uint8Array', () => {
      const result = toStringOrBytes([])
      expect(result).toBeInstanceOf(Uint8Array)
      expect((result as Uint8Array).byteLength).toBe(0)
    })

    it('array of ArrayBuffers concatenates to bytes', () => {
      const a = new TextEncoder().encode('ab').buffer
      const b = new TextEncoder().encode('cd').buffer
      const result = toStringOrBytes([a, b])
      expect(result).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(result as Uint8Array)).toBe('abcd')
    })

    it('array of Uint8Arrays concatenates to bytes', () => {
      const a = new Uint8Array([1, 2])
      const b = new Uint8Array([3, 4])
      const result = toStringOrBytes([a, b])
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4]))
    })

    it('array of byte-view-like objects concatenates to bytes', () => {
      const source = new Uint8Array([9, 8, 7, 6])
      const view: Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'> = {
        buffer: source.buffer,
        byteOffset: 1,
        byteLength: 2,
      }
      const result = toStringOrBytes([view])
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result).toEqual(new Uint8Array([8, 7]))
    })

    it('mixed array (strings + bytes) concatenates to bytes, UTF-8 encoding strings', () => {
      const result = toStringOrBytes(['te', new Uint8Array([0x73, 0x74])]) // 'st'
      expect(result).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(result as Uint8Array)).toBe('test')
    })

    it('mixed array preserves item order across all byte-like variants', () => {
      const strPart = 'a' // 1 byte
      const bufPart = new TextEncoder().encode('b').buffer // 1 byte
      const u8Part = new Uint8Array([0x63]) // 'c', 1 byte
      const source = new Uint8Array([0x64, 0x65]) // 'd', 'e'
      const viewPart: Pick<Uint8Array<ArrayBuffer>, 'buffer' | 'byteOffset' | 'byteLength'> = {
        buffer: source.buffer,
        byteOffset: 0,
        byteLength: 1,
      } // 'd'

      const result = toStringOrBytes([strPart, bufPart, u8Part, viewPart])
      expect(new TextDecoder().decode(result as Uint8Array)).toBe('abcd')
    })

    it('mixed array with multi-byte UTF-8 string encodes correctly', () => {
      const result = toStringOrBytes(['€', new Uint8Array([0x21])]) // '€' is 3 bytes in UTF-8, then '!'
      const expectedBytes = new Uint8Array([...new TextEncoder().encode('€'), 0x21])
      expect(result).toEqual(expectedBytes)
    })
  })
})

describe('encodeBase64', () => {
  const large = new Uint8Array(20_000).map((_, i) => i % 256)

  function expectEncodes() {
    expect(encodeBase64(new Uint8Array([]))).toBe('')
    expect(encodeBase64(new TextEncoder().encode('Hello World'))).toBe('SGVsbG8gV29ybGQ=')
    expect(encodeBase64(new Uint8Array([251, 255]))).toBe('+/8=')
    expect(encodeBase64(new Uint8Array([0, 251, 255, 0]).subarray(1, 3))).toBe('+/8=')
    expect(encodeBase64(large)).toBe(Buffer.from(large).toString('base64'))
  }

  // runtimes like Node.js 26 ship the native toBase64, which would skip the fallbacks
  function removeNativeToBase64() {
    const descriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64')

    if (descriptor) {
      delete (Uint8Array.prototype as any).toBase64
      onTestFinished(() => {
        // eslint-disable-next-line no-extend-native -- restores the native method removed above
        Object.defineProperty(Uint8Array.prototype, 'toBase64', descriptor)
      })
    }
  }

  it('uses Buffer from the Node.js built-in modules when available', () => {
    removeNativeToBase64()
    const getBuiltinModule = vi.spyOn(process, 'getBuiltinModule')
    onTestFinished(() => {
      getBuiltinModule.mockRestore()
    })

    expectEncodes()
    expect(getBuiltinModule).toHaveBeenCalledWith('node:buffer')
  })

  it('falls back to btoa without the Node.js built-in modules', () => {
    removeNativeToBase64()
    const getBuiltinModule = vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined as any)
    onTestFinished(() => {
      getBuiltinModule.mockRestore()
    })

    expectEncodes()
  })

  it('falls back to btoa on runtimes without getBuiltinModule', () => {
    removeNativeToBase64()
    const getBuiltinModule = process.getBuiltinModule
    ;(process as any).getBuiltinModule = undefined
    onTestFinished(() => {
      process.getBuiltinModule = getBuiltinModule
    })

    expectEncodes()
  })

  it('prefers the native toBase64', () => {
    const toBase64 = vi.fn(() => 'native')
    const bytes = Object.assign(new Uint8Array([1]), { toBase64 })

    expect(encodeBase64(bytes)).toBe('native')
    expect(toBase64).toHaveBeenCalledTimes(1)
  })
})

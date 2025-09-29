import type { StandardHeaders } from '@orpc/standard-server'
import { decodeRequestMessage, decodeResponseMessage, encodeRequestMessage, encodeResponseMessage, MessageType } from './codec'

const MB10Headers: StandardHeaders = {}

for (let i = 0; i < 300000; i++) {
  MB10Headers[`header-${i}`] = Array.from({ length: 10 }, () => String.fromCharCode(Math.floor(Math.random() * 256))).join('')
}

describe('encode/decode request message', () => {
  it('abort signal', async () => {
    const message = await encodeRequestMessage('198', MessageType.ABORT_SIGNAL, undefined)

    expect(message).toBeTypeOf('string')

    const [id, type, payload] = await decodeRequestMessage(message)

    expect(id).toBe('198')
    expect(type).toBe(MessageType.ABORT_SIGNAL)
    expect(payload).toBeUndefined()
  })

  it('event iterator', async () => {
    const message = await encodeRequestMessage('198', MessageType.EVENT_ITERATOR, {
      event: 'message',
      data: 'hello',
      meta: {
        id: 'id-1',
        retry: 0,
        comments: [],
      },
    })

    expect(message).toBeTypeOf('string')

    const [id, type, payload] = await decodeRequestMessage(message)

    expect(id).toBe('198')
    expect(type).toBe(MessageType.EVENT_ITERATOR)
    expect(payload).toEqual({
      event: 'message',
      data: 'hello',
      meta: {
        id: 'id-1',
        retry: 0,
        comments: [],
      },
    })
  })

  describe.each([
    ['GET', new URL('orpc://localhost/api/v1/users/1?a=1&b=2'), {}],
    ['GET', new URL('orpc:///localhost/api/v1/users/1?a=1&b=2'), {}],
    ['GET', new URL('orpc://example.com/api/v1/users/1?a=1&b=2'), {}],
    ['GET', new URL('orpc:///example.com/api/v1/users/1?a=1&b=2'), {}],
    ['GET', new URL('orpc:/api/v1/users/1?a=1&b=2'), {}],
    ['GET', new URL('orpc://api/v1/users/1?a=1&b=2'), {}],
    ['GET', new URL('https://example.com/api/v1/users/1?a=1&b=2'), {}],
    ['POST', new URL('https://example.com/api/v1/users/1'), { 'x-custom-header': 'value' }],
    ['DELETE', new URL('https://example.com/api/v1/users/1'), { }],
  ] as const)('request %s', (method, url, headers) => {
    it('undefined', async () => {
      const message = await encodeRequestMessage('198', MessageType.REQUEST, {
        url,
        headers,
        method,
        body: undefined,
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeRequestMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.REQUEST)
      expect(payload).toEqual({
        url,
        headers,
        method,
        body: undefined,
      })
    })

    it('json', async () => {
      const message = await encodeRequestMessage('198', MessageType.REQUEST, {
        url,
        headers,
        method,
        body: { value: 1 },
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeRequestMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.REQUEST)
      expect(payload).toEqual({
        url,
        headers,
        method,
        body: { value: 1 },
      })
    })

    it('json buffer', async () => {
      const message = await encodeRequestMessage('198', MessageType.REQUEST, {
        url,
        headers,
        method,
        body: { value: 1 },
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeRequestMessage(new TextEncoder().encode(message as string))

      expect(id).toBe('198')
      expect(type).toBe(MessageType.REQUEST)
      expect(payload).toEqual({
        url,
        headers,
        method,
        body: { value: 1 },
      })
    })

    it('urlSearchParams', async () => {
      const query = new URLSearchParams('a=1&b=2')

      const message = await encodeRequestMessage('198', MessageType.REQUEST, {
        url,
        headers,
        method,
        body: query,
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeRequestMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.REQUEST)
      expect(payload).toEqual({
        url,
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
        method,
        body: query,
      })
    })

    it('event iterator', async () => {
      const message = await encodeRequestMessage('198', MessageType.REQUEST, {
        url,
        method,
        headers,
        body: (async function* () { })(),
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeRequestMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.REQUEST)
      expect(payload).toEqual({
        url,
        method,
        headers: { ...headers, 'content-type': 'text/event-stream' },
        body: undefined,
      })
    })

    it('formData', async () => {
      const formData = new FormData()
      formData.append('a', '1')
      formData.append('b', '2')
      formData.append('file', new File(['foo'], 'some-name.pdf', { type: 'application/pdf' }))

      const message = await encodeRequestMessage('198', MessageType.REQUEST, {
        url,
        headers,
        method,
        body: formData,
      })

      expect(message).toBeInstanceOf(Uint8Array)

      const [id, type, payload] = await decodeRequestMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.REQUEST)
      expect(payload).toEqual({
        url,
        headers: {
          ...headers,
          'content-type': expect.stringContaining('multipart/form-data'),
        },
        method,
        body: formData,
      })

      expect(await (payload as any).body.get('a')).toBe('1')
      expect(await (payload as any).body.get('b')).toBe('2')
      expect(await (payload as any).body.get('file').text()).toBe('foo')
    })

    it('formData with message is Uint8Array', async () => {
      const formData = new FormData()
      formData.append('a', '1')
      formData.append('b', '2')
      formData.append('file', new File(['foo'], 'some-name.pdf', { type: 'application/pdf' }))

      const message = await encodeRequestMessage('198', MessageType.REQUEST, {
        url,
        headers,
        method,
        body: formData,
      })

      expect(message).toBeInstanceOf(Uint8Array)

      const [id, type, payload] = await decodeRequestMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.REQUEST)
      expect(payload).toEqual({
        url,
        headers: {
          ...headers,
          'content-type': expect.stringContaining('multipart/form-data'),
        },
        method,
        body: formData,
      })

      expect(await (payload as any).body.get('a')).toBe('1')
      expect(await (payload as any).body.get('b')).toBe('2')
      expect(await (payload as any).body.get('file').text()).toBe('foo')
    })

    describe.each([
      ['multipart/form-data'],
      ['application/x-www-form-urlencoded'],
      ['application/json'],
      ['application/pdf'],
      ['text/plain'],
    ])('type: %s', async (contentType) => {
      it('blob', async () => {
        const blob = new Blob(['foo'], { type: contentType })

        const message = await encodeRequestMessage('198', MessageType.REQUEST, {
          url,
          headers,
          method,
          body: blob,
        })

        expect(message).toBeInstanceOf(Uint8Array)

        const [id, type, payload] = await decodeRequestMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.REQUEST)
        expect(payload).toEqual({
          url,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': expect.any(String),
          },
          method,
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('foo')
      })

      it('blob with custom content-disposition', async () => {
        const blob = new Blob(['foo'], { type: contentType })

        const message = await encodeRequestMessage('198', MessageType.REQUEST, {
          url,
          headers: {
            ...headers,
            'content-disposition': 'attachment; filename="some-name.pdf"',
          },
          method,
          body: blob,
        })

        expect(message).toBeInstanceOf(Uint8Array)

        const [id, type, payload] = await decodeRequestMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.REQUEST)
        expect(payload).toEqual({
          url,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': 'attachment; filename="some-name.pdf"',
          },
          method,
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('foo')
      })

      it('empty blob', async () => {
        const blob = new Blob([], { type: contentType })

        const message = await encodeRequestMessage('198', MessageType.REQUEST, {
          url,
          headers,
          method,
          body: blob,
        })

        expect(message).toBeTypeOf('string')

        const [id, type, payload] = await decodeRequestMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.REQUEST)
        expect(payload).toEqual({
          url,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': expect.any(String),
          },
          method,
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('')
      })

      it('file', async () => {
        const file = new File(['foo'], 'some-name.pdf', { type: contentType })

        const message = await encodeRequestMessage('198', MessageType.REQUEST, {
          url,
          headers,
          method,
          body: file,
        })

        expect(message).toBeInstanceOf(Uint8Array)

        const [id, type, payload] = await decodeRequestMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.REQUEST)
        expect(payload).toEqual({
          url,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': expect.any(String),
          },
          method,
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('foo')
      })

      it('file with custom content-disposition', async () => {
        const file = new File(['foo'], 'some-name.pdf', { type: contentType })

        const message = await encodeRequestMessage('198', MessageType.REQUEST, {
          url,
          headers: {
            ...headers,
            'content-disposition': 'attachment',
          },
          method,
          body: file,
        })

        expect(message).toBeInstanceOf(Uint8Array)

        const [id, type, payload] = await decodeRequestMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.REQUEST)
        expect(payload).toEqual({
          url,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': 'attachment',
          },
          method,
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('foo')
      })

      it('empty file', async () => {
        const file = new File([], 'some-name.pdf', { type: contentType })

        const message = await encodeRequestMessage('198', MessageType.REQUEST, {
          url,
          headers,
          method,
          body: file,
        })

        expect(message).toBeTypeOf('string')

        const [id, type, payload] = await decodeRequestMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.REQUEST)
        expect(payload).toEqual({
          url,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': expect.any(String),
          },
          method,
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('')
      })
    })
  })

  it('request blob large size', { timeout: 10000 }, async () => {
    const json = JSON.stringify(MB10Headers)
    const blob = new Blob([json], { type: 'application/pdf' })

    const url = new URL('https://example.com/api/v1/users/1')
    const method = 'DELETE'

    const message = await encodeRequestMessage('198', MessageType.REQUEST, {
      url,
      method,
      headers: MB10Headers,
      body: blob,
    })

    expect(message).toBeInstanceOf(Uint8Array)

    const [id, type, payload] = await decodeRequestMessage(message)

    expect(id).toBe('198')
    expect(type).toBe(MessageType.REQUEST)
    expect(payload).toEqual({
      url,
      method,
      headers: {
        ...MB10Headers,
        'content-type': 'application/pdf',
        'content-disposition': expect.any(String),
      },
      body: expect.toSatisfy(blob => blob instanceof Blob),
    })

    expect(await (payload as any).body.text()).toBe(json)
  })

  it('decode accept buffer data', async () => {
    const blob = new Blob(['foo'], { type: 'application/pdf' })

    const message = await encodeRequestMessage('198', MessageType.REQUEST, {
      method: 'POST',
      url: new URL('https://example.com/api/v1/users/1'),
      headers: {},
      body: blob,
    })

    expect(message).toBeInstanceOf(Uint8Array)
    const unit8Array = message as Uint8Array
    const buffer = unit8Array.buffer.slice(unit8Array.byteOffset, unit8Array.byteOffset + unit8Array.byteLength)

    const [id, type, payload] = await decodeRequestMessage(buffer)

    expect(id).toBe('198')
    expect(type).toBe(MessageType.REQUEST)
    expect(payload).toEqual({
      url: new URL('https://example.com/api/v1/users/1'),
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': expect.any(String),
      },
      method: 'POST',
      body: expect.toSatisfy(blob => blob instanceof Blob),
    })

    expect(await (payload as any).body.text()).toBe('foo')
  })
})

describe('encode/decode response message', () => {
  it('abort signal', async () => {
    const message = await encodeResponseMessage('198', MessageType.ABORT_SIGNAL, undefined)

    expect(message).toBeTypeOf('string')

    const [id, type, payload] = await decodeResponseMessage(message)

    expect(id).toBe('198')
    expect(type).toBe(MessageType.ABORT_SIGNAL)
    expect(payload).toBeUndefined()
  })

  it('event iterator', async () => {
    const message = await encodeResponseMessage('198', MessageType.EVENT_ITERATOR, {
      event: 'message',
      data: 'hello',
      meta: {
        id: 'id-1',
        retry: 0,
        comments: [],
      },
    })

    expect(message).toBeTypeOf('string')

    const [id, type, payload] = await decodeResponseMessage(message)

    expect(id).toBe('198')
    expect(type).toBe(MessageType.EVENT_ITERATOR)
    expect(payload).toEqual({
      event: 'message',
      data: 'hello',
      meta: {
        id: 'id-1',
        retry: 0,
        comments: [],
      },
    })
  })

  describe.each([
    [200, {}],
    [201, { 'x-custom-header': 'value' }],
    [400, {}],
  ] as const)('response %s', (status, headers) => {
    it('undefined', async () => {
      const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
        status,
        headers,
        body: undefined,
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeResponseMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.RESPONSE)
      expect(payload).toEqual({
        status,
        headers,
        body: undefined,
      })
    })

    it('json', async () => {
      const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
        status,
        headers,
        body: { value: 1 },
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeResponseMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.RESPONSE)
      expect(payload).toEqual({
        status,
        headers,
        body: { value: 1 },
      })
    })

    it('json buffer', async () => {
      const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
        status,
        headers,
        body: { value: 1 },
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeResponseMessage(new TextEncoder().encode(message as string))

      expect(id).toBe('198')
      expect(type).toBe(MessageType.RESPONSE)
      expect(payload).toEqual({
        status,
        headers,
        body: { value: 1 },
      })
    })

    it('urlSearchParams', async () => {
      const query = new URLSearchParams('a=1&b=2')

      const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
        status,
        headers,
        body: query,
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeResponseMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.RESPONSE)
      expect(payload).toEqual({
        status,
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
        body: query,
      })
    })

    it('event iterator', async () => {
      const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
        status,
        headers,
        body: (async function* () {})(),
      })

      expect(message).toBeTypeOf('string')

      const [id, type, payload] = await decodeResponseMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.RESPONSE)
      expect(payload).toEqual({
        status,
        headers: { ...headers, 'content-type': 'text/event-stream' },
        body: undefined,
      })
    })

    it('formData', async () => {
      const formData = new FormData()
      formData.append('a', '1')
      formData.append('b', '2')
      formData.append('file', new File(['foo'], 'some-name.pdf', { type: 'application/pdf' }))

      const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
        status,
        headers,
        body: formData,
      })

      expect(message).toBeInstanceOf(Uint8Array)

      const [id, type, payload] = await decodeResponseMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.RESPONSE)
      expect(payload).toEqual({
        status,
        headers: {
          ...headers,
          'content-type': expect.stringContaining('multipart/form-data'),
        },
        body: formData,
      })

      expect(await (payload as any).body.get('a')).toBe('1')
      expect(await (payload as any).body.get('b')).toBe('2')
      expect(await (payload as any).body.get('file').text()).toBe('foo')
    })

    it('formData with message is Uint8Array', async () => {
      const formData = new FormData()
      formData.append('a', '1')
      formData.append('b', '2')
      formData.append('file', new File(['foo'], 'some-name.pdf', { type: 'application/pdf' }))

      const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
        status,
        headers,
        body: formData,
      })

      expect(message).toBeInstanceOf(Uint8Array)

      const [id, type, payload] = await decodeResponseMessage(message)

      expect(id).toBe('198')
      expect(type).toBe(MessageType.RESPONSE)
      expect(payload).toEqual({
        status,
        headers: {
          ...headers,
          'content-type': expect.stringContaining('multipart/form-data'),
        },
        body: formData,
      })

      expect(await (payload as any).body.get('a')).toBe('1')
      expect(await (payload as any).body.get('b')).toBe('2')
      expect(await (payload as any).body.get('file').text()).toBe('foo')
    })

    describe.each([
      ['multipart/form-data'],
      ['application/x-www-form-urlencoded'],
      ['application/json'],
      ['application/pdf'],
      ['text/plain'],
    ])('type: %s', async (contentType) => {
      it('blob', async () => {
        const blob = new Blob(['foo'], { type: contentType })

        const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
          status,
          headers,
          body: blob,
        })

        expect(message).toBeInstanceOf(Uint8Array)

        const [id, type, payload] = await decodeResponseMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.RESPONSE)
        expect(payload).toEqual({
          status,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': expect.any(String),
          },
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('foo')
      })

      it('blob with custom content-disposition', async () => {
        const blob = new Blob(['foo'], { type: contentType })

        const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
          status,
          headers: {
            ...headers,
            'content-disposition': 'attachment; filename="some-name.pdf"',
          },
          body: blob,
        })

        expect(message).toBeInstanceOf(Uint8Array)

        const [id, type, payload] = await decodeResponseMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.RESPONSE)
        expect(payload).toEqual({
          status,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': 'attachment; filename="some-name.pdf"',
          },
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('foo')
      })

      it('file', async () => {
        const file = new File(['foo'], 'some-name.pdf', { type: contentType })

        const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
          status,
          headers,
          body: file,
        })

        expect(message).toBeInstanceOf(Uint8Array)

        const [id, type, payload] = await decodeResponseMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.RESPONSE)
        expect(payload).toEqual({
          status,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': expect.any(String),
          },
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('foo')
      })

      it('file with custom content-disposition', async () => {
        const file = new File(['foo'], 'some-name.pdf', { type: contentType })

        const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
          status,
          headers: {
            ...headers,
            'content-disposition': 'attachment',
          },
          body: file,
        })

        expect(message).toBeInstanceOf(Uint8Array)

        const [id, type, payload] = await decodeResponseMessage(message)

        expect(id).toBe('198')
        expect(type).toBe(MessageType.RESPONSE)
        expect(payload).toEqual({
          status,
          headers: {
            ...headers,
            'content-type': contentType,
            'content-disposition': 'attachment',
          },
          body: expect.toSatisfy(blob => blob instanceof Blob),
        })

        expect(await (payload as any).body.text()).toBe('foo')
      })
    })
  })

  it('response blob large size', { timeout: 10000 }, async () => {
    const json = JSON.stringify(MB10Headers)
    const blob = new Blob([json], { type: 'application/pdf' })

    const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
      status: 203,
      headers: MB10Headers,
      body: blob,
    })

    expect(message).toBeInstanceOf(Uint8Array)

    const [id, type, payload] = await decodeResponseMessage(message)

    expect(id).toBe('198')
    expect(type).toBe(MessageType.RESPONSE)
    expect(payload).toEqual({
      status: 203,
      headers: {
        ...MB10Headers,
        'content-type': 'application/pdf',
        'content-disposition': expect.any(String),
      },
      body: expect.toSatisfy(blob => blob instanceof Blob),
    })

    expect(await (payload as any).body.text()).toBe(json)
  })

  it('decode accept buffer data', async () => {
    const blob = new Blob(['foo'], { type: 'application/pdf' })

    const message = await encodeResponseMessage('198', MessageType.RESPONSE, {
      status: 200,
      headers: {},
      body: blob,
    })

    expect(message).toBeInstanceOf(Uint8Array)
    const unit8Array = message as Uint8Array
    const buffer = unit8Array.buffer.slice(unit8Array.byteOffset, unit8Array.byteOffset + unit8Array.byteLength)

    const [id, type, payload] = await decodeResponseMessage(buffer)

    expect(id).toBe('198')
    expect(type).toBe(MessageType.RESPONSE)
    expect(payload).toEqual({
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': expect.any(String),
      },
      body: expect.toSatisfy(blob => blob instanceof Blob),
    })

    expect(await (payload as any).body.text()).toBe('foo')
  })
})

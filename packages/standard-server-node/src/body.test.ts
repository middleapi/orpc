import type { StandardBody } from '@orpc/standard-server'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { isAsyncIteratorObject } from '@orpc/shared'
import * as StandardServerModule from '@orpc/standard-server'
import request from 'supertest'
import { toNodeHttpBody, toStandardBody } from './body'
import * as EventIteratorModule from './event-iterator'

const toEventStreamSpy = vi.spyOn(EventIteratorModule, 'toEventStream')
const generateContentDispositionSpy = vi.spyOn(StandardServerModule, 'generateContentDisposition')
const getFilenameFromContentDispositionSpy = vi.spyOn(StandardServerModule, 'getFilenameFromContentDisposition')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('toStandardBody', () => {
  it('undefined', async () => {
    let standardBody: StandardBody = {} as any

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    }).get('/')

    expect(standardBody).toBe(undefined)

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    }).head('/')

    expect(standardBody).toBe(undefined)

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    }).post('/')
  })

  it('json', async () => {
    let standardBody: StandardBody = {} as any

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    }).post('/').send({ foo: 'bar' })

    expect(standardBody).toEqual({ foo: 'bar' })
  })

  it('json but empty body', async () => {
    let standardBody: StandardBody = {} as any

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    }).post('/').type('application/json').send('')

    expect(standardBody).toEqual(undefined)
  })

  it('event iterator', async () => {
    let standardBody: any

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)

      res.end()
    })
      .delete('/')
      .type('text/event-stream')
      .send('event: message\ndata: 123\n\nevent: done\ndata: 456\n\n')

    expect(standardBody).toSatisfy(isAsyncIteratorObject)

    expect(await standardBody.next()).toEqual({ done: false, value: 123 })
    expect(await standardBody.next()).toEqual({ done: true, value: 456 })
  })

  it('text', async () => {
    let standardBody: StandardBody = {} as any

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    })
      .delete('/')
      .type('text/plain')
      .send('foo')

    expect(standardBody).toBe('foo')
  })

  it('form-data', async () => {
    let standardBody: any

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    })
      .delete('/')
      .field('foo', 'bar')
      .field('bar', 'baz')

    expect(standardBody).toBeInstanceOf(FormData)
    expect(standardBody.get('foo')).toBe('bar')
    expect(standardBody.get('bar')).toBe('baz')
  })

  it('url-search-params', async () => {
    let standardBody: any

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    })
      .delete('/')
      .send('foo=bar&bar=baz')

    expect(standardBody).toEqual(new URLSearchParams('foo=bar&bar=baz'))
  })

  it('blob', async () => {
    let standardBody: any

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    })
      .delete('/')
      .type('application/pdf')
      .send(Buffer.from('foo'))

    expect(standardBody).toBeInstanceOf(File)
    expect(standardBody.name).toBe('blob')
    expect(standardBody.type).toBe('application/pdf')
    expect(await standardBody.text()).toBe('foo')

    expect(getFilenameFromContentDispositionSpy).toHaveBeenCalledTimes(0)
  })

  it('file', async () => {
    let standardBody: any

    getFilenameFromContentDispositionSpy.mockReturnValue('__name__')

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    })
      .delete('/')
      .type('application/json')
      .set('content-disposition', 'attachment; filename="foo.pdf"')
      .send({ value: 123 })

    expect(standardBody).toBeInstanceOf(File)
    expect(standardBody.name).toBe('__name__')
    expect(standardBody.type).toBe('application/json')
    expect(await standardBody.text()).toBe('{"value":123}')

    expect(getFilenameFromContentDispositionSpy).toHaveBeenCalledTimes(1)
    expect(getFilenameFromContentDispositionSpy).toHaveBeenCalledWith('attachment; filename="foo.pdf"')
  })

  it('file with content-disposition (no filename)', async () => {
    let standardBody: any

    getFilenameFromContentDispositionSpy.mockReturnValue(undefined)

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      standardBody = await toStandardBody(req)
      res.end()
    })
      .delete('/')
      .type('application/json')
      .set('content-disposition', 'attachment')
      .send({ value: 123 })

    expect(standardBody).toBeInstanceOf(File)
    expect(standardBody.name).toBe('blob')
    expect(standardBody.type).toBe('application/json')
    expect(await standardBody.text()).toBe('{"value":123}')

    expect(getFilenameFromContentDispositionSpy).toHaveBeenCalledTimes(1)
    expect(getFilenameFromContentDispositionSpy).toHaveBeenCalledWith('attachment')
  })

  it('prefer parsed body', async () => {
    let standardBody: StandardBody = {} as any

    await request(async (req: IncomingMessage, res: ServerResponse) => {
      // @ts-expect-error fake body is parsed
      req.body = { value: 123 }
      standardBody = await toStandardBody(req)
      res.end()
    }).post('/').send()

    expect(standardBody).toEqual({ value: 123 })
  })
})

describe('toNodeHttpBody', () => {
  const baseHeaders = {
    'content-type': 'application/json',
    'x-custom-header': 'custom-value',
  }

  it('undefined', () => {
    const headers = { ...baseHeaders }
    const body = toNodeHttpBody(undefined, headers, {})

    expect(body).toBe(undefined)
    expect(headers).toEqual({
      'x-custom-header': 'custom-value',
    })
  })

  it('json', () => {
    const headers = { ...baseHeaders }
    const body = toNodeHttpBody({ foo: 'bar' }, headers, {})

    expect(body).toBe('{"foo":"bar"}')
    expect(headers).toEqual({
      'content-type': 'application/json',
      'x-custom-header': 'custom-value',
    })
  })

  it('form-data', async () => {
    const headers = { ...baseHeaders }
    const form = new FormData()
    form.append('foo', 'bar')
    form.append('bar', 'baz')

    const body = toNodeHttpBody(form, headers, {})

    expect(body).toBeInstanceOf(Readable)
    expect(headers).toEqual({
      'x-custom-header': 'custom-value',
      'content-type': expect.stringMatching(/multipart\/form-data; .+/),
    })

    const response = new Response(body, {
      headers,
    })
    const resForm = await response.formData()

    expect(resForm.get('foo')).toBe('bar')
    expect(resForm.get('bar')).toBe('baz')
  })

  it('url-search-params', async () => {
    const headers = { ...baseHeaders }
    const query = new URLSearchParams('foo=bar&bar=baz')

    const body = toNodeHttpBody(query, headers, {})

    expect(body).toBe('foo=bar&bar=baz')
    expect(headers).toEqual({
      'x-custom-header': 'custom-value',
      'content-type': 'application/x-www-form-urlencoded',
    })
  })

  it('blob', async () => {
    const headers = { ...baseHeaders }
    const blob = new Blob(['foo'], { type: 'application/pdf' })

    generateContentDispositionSpy.mockReturnValue('__mocked__')

    const body = toNodeHttpBody(blob, headers, {})

    expect(body).toBeInstanceOf(Readable)
    expect(headers).toEqual({
      'content-disposition': '__mocked__',
      'content-length': '3',
      'content-type': 'application/pdf',
      'x-custom-header': 'custom-value',
    })

    expect(generateContentDispositionSpy).toHaveBeenCalledTimes(1)
    expect(generateContentDispositionSpy).toHaveBeenCalledWith('blob')

    const response = new Response(body, {
      headers,
    })
    const resBlob = await response.blob()

    expect(resBlob.type).toBe('application/pdf')
    expect(await resBlob.text()).toBe('foo')
  })

  it('file', async () => {
    const headers = { ...baseHeaders }
    const blob = new File(['foo'], 'foo.pdf', { type: 'application/pdf' })

    generateContentDispositionSpy.mockReturnValue('__mocked__')

    const body = toNodeHttpBody(blob, headers, {})

    expect(body).instanceOf(Readable)
    expect(headers).toEqual({
      'content-disposition': '__mocked__',
      'content-length': '3',
      'content-type': 'application/pdf',
      'x-custom-header': 'custom-value',
    })

    expect(generateContentDispositionSpy).toHaveBeenCalledTimes(1)
    expect(generateContentDispositionSpy).toHaveBeenCalledWith('foo.pdf')

    const response = new Response(body, {
      headers,
    })
    const resBlob = await response.blob()

    expect(resBlob.type).toBe('application/pdf')
    expect(await resBlob.text()).toBe('foo')
  })

  it('file with content-disposition', async () => {
    const headers = { ...baseHeaders, 'content-disposition': 'attachment; filename="foo.pdf"' }
    const blob = new File(['foo'], 'foo.pdf', { type: 'application/pdf' })

    const body = toNodeHttpBody(blob, headers, {})

    expect(body).instanceOf(Readable)
    expect(headers).toEqual({
      'content-disposition': 'attachment; filename="foo.pdf"',
      'content-length': '3',
      'content-type': 'application/pdf',
      'x-custom-header': 'custom-value',
    })

    expect(generateContentDispositionSpy).toHaveBeenCalledTimes(0)

    const response = new Response(body, {
      headers,
    })
    const resBlob = await response.blob()

    expect(resBlob.type).toBe('application/pdf')
    expect(await resBlob.text()).toBe('foo')
  })

  it('async generator', async () => {
    async function* gen() {
      yield 123
      return 456
    }
    const options = { eventIteratorKeepAliveEnabled: true }
    const headers = { ...baseHeaders }
    const iterator = gen()
    const body = toNodeHttpBody(iterator, headers, options)

    expect(toEventStreamSpy).toHaveBeenCalledWith(iterator, options)

    expect(body).toBeInstanceOf(Readable)
    expect(headers).toEqual({
      'content-type': 'text/event-stream',
      'x-custom-header': 'custom-value',
    })

    const reader = Readable.toWeb((body as Readable)).pipeThrough(new TextDecoderStream()).getReader()

    expect(await reader.read()).toEqual({ done: false, value: ': \n\n' })
    expect(await reader.read()).toEqual({ done: false, value: 'event: message\ndata: 123\n\n' })
    expect(await reader.read()).toEqual({ done: false, value: 'event: done\ndata: 456\n\n' })
  })
})

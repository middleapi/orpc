import { asyncIteratorObject, eventIterator, oc } from '@orpc/contract'
import z from 'zod'
import { openrpc, OpenRPCGenerator } from '../../src'
import { zodJsonSchemaConverter } from '../__shared__/schema'

describe('openRPCGenerator e2e: event iterator streaming', () => {
  const generator = new OpenRPCGenerator({ converters: [zodJsonSchemaConverter] })

  it('skips streaming procedures, which JSON-RPC over HTTP cannot serve, and keeps request/response ones', async () => {
    const doc = await generator.generate({
      chat: {
        stream: oc
          .input(asyncIteratorObject(z.object({ prompt: z.string() }), z.object({ done: z.boolean() })))
          .output(asyncIteratorObject(z.object({ delta: z.string() }), z.object({ usage: z.number() }))),
        send: oc
          .input(z.object({ prompt: z.string() }))
          .output(z.object({ reply: z.string() })),
      },
      notifications: oc.output(eventIterator(z.object({ title: z.string() }))),
      // skipped before validation, so its file chunks are not reported
      upload: oc.input(eventIterator(z.object({ chunk: z.file() }))),
    })

    expect(doc).toEqual({
      openrpc: '1.3.2',
      info: { title: 'API Reference', version: '0.0.0' },
      methods: [{
        name: 'chat.send',
        paramStructure: 'by-name',
        params: [{ name: 'prompt', required: true, schema: { type: 'string' } }],
        result: {
          name: 'result',
          schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false },
        },
      }],
    })
  })

  it('skips streaming procedures even when an openrpc spec object describes them', async () => {
    const doc = await generator.generate({
      live: oc
        .meta(openrpc({ spec: { name: 'live', params: [] } }))
        .output(eventIterator(z.string())),
    })

    expect(doc.methods).toEqual([])
  })

  it('does not register components used only by skipped streaming procedures', async () => {
    const Message = z.object({ text: z.string() }).meta({ id: 'Message' })
    const Notification = z.object({ title: z.string() }).meta({ id: 'Notification' })

    const doc = await generator.generate({
      messages: oc.output(eventIterator(Message)),
      notifications: oc.output(eventIterator(Notification)),
      lastMessage: oc.output(Message),
    })

    expect(doc.methods).toEqual([
      expect.objectContaining({ name: 'lastMessage', result: { name: 'result', schema: { $ref: '#/components/schemas/Message' } } }),
    ])
    expect(doc.components).toEqual({
      schemas: {
        Message: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      },
    })
  })
})

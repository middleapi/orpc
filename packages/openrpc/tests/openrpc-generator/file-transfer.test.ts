import { oc } from '@orpc/contract'
import z from 'zod'
import { openrpc, OpenRPCGenerator, OpenRPCGeneratorError } from '../../src'
import { zodJsonSchemaConverter } from '../__shared__/schema'

describe('openRPCGenerator e2e: file upload and download', () => {
  const generator = new OpenRPCGenerator({ converters: [zodJsonSchemaConverter] })

  async function generateError(...args: Parameters<OpenRPCGenerator['generate']>): Promise<unknown> {
    return generator.generate(...args).then(
      () => { throw new Error('expected generate to reject') },
      e => e,
    )
  }

  it('reports form uploads and mixed union downloads in one aggregated error', async () => {
    const error = await generateError({
      avatar: {
        upload: oc.input(z.object({ userId: z.string(), image: z.file().mime(['image/png', 'image/jpeg']) })),
      },
      exportPlanets: oc.output(z.union([z.file().mime('text/csv'), z.array(z.object({ id: z.string() }))])),
    })

    expect(error).toBeInstanceOf(OpenRPCGeneratorError)
    expect((error as Error).message).toBe([
      '[OpenRPCGenerator] Failed to generate the OpenRPC document:',
      'Procedure at avatar.upload: File/Blob schemas cannot be sent over JSON-RPC.',
      'Procedure at exportPlanets: File/Blob schemas cannot be sent over JSON-RPC.',
    ].join('\n\n'))
  })

  it('finds files hidden in reusable components and recursive schemas', async () => {
    const Attachment = z.file().meta({ id: 'Attachment' })
    const Folder: z.ZodTypeAny = z.looseObject({
      name: z.string(),
      get files() { return z.array(Attachment) },
      get folders() { return z.array(Folder) },
    }).meta({ id: 'Folder' })

    const error = await generateError({
      sendMessage: oc.input(z.object({ text: z.string(), attachments: z.array(Attachment).optional() })),
      getFolder: oc.output(Folder),
    })

    expect((error as Error).message).toContain('Procedure at sendMessage: File/Blob schemas cannot be sent over JSON-RPC.')
    expect((error as Error).message).toContain('Procedure at getFolder: File/Blob schemas cannot be sent over JSON-RPC.')
  })

  it('still rejects file procedures whose openrpc spec function only transforms the generated method', async () => {
    const error = await generateError({
      upload: oc
        .meta(openrpc({ spec: method => ({ ...method, 'x-internal': true }) }))
        .input(z.file()),
    })

    expect((error as Error).message).toContain('Procedure at upload: File/Blob schemas cannot be sent over JSON-RPC.')
  })
})

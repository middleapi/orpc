import { ArkTypeToJsonSchemaConverter } from '@orpc/arktype'
import { oc } from '@orpc/contract'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ValibotToJsonSchemaConverter } from '@orpc/valibot'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { type } from 'arktype'
import * as v from 'valibot'
import * as z from 'zod'

const zodFile = { type: 'string', format: 'binary', contentEncoding: 'binary' }

describe('openAPIGenerator with file schemas', () => {
  const generator = new OpenAPIGenerator({
    converters: [
      new ValibotToJsonSchemaConverter(),
      new ArkTypeToJsonSchemaConverter(),
      new ZodToJsonSchemaConverter(),
    ],
  })

  it.each([
    [
      'valibot',
      v.object({ avatar: v.pipe(v.file(), v.mimeType(['image/png'])), name: v.string() }),
      { type: 'string', contentMediaType: 'image/png' },
    ],
    [
      'arktype',
      type({ avatar: 'File', name: 'string' }),
      { type: 'string', contentMediaType: '*/*' },
    ],
    [
      'zod',
      z.object({ avatar: z.file().mime(['image/png']), name: z.string() }),
      { ...zodFile, contentMediaType: 'image/png' },
    ],
  ])('documents %s inputs with files as a multipart/form-data body', async (_, schema, avatar) => {
    const doc = await generator.generate({ upload: oc.input(schema) })

    expect(doc.paths?.['/upload']?.post?.requestBody).toEqual({
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              avatar,
              name: { type: 'string' },
            },
            required: ['avatar', 'name'],
          },
        },
      },
    })
  })

  it.each([
    ['valibot blob', v.blob(), { type: 'string', contentMediaType: '*/*' }],
    ['arktype Blob', type('Blob'), { type: 'string', contentMediaType: '*/*' }],
    ['zod file', z.file(), zodFile],
  ])('documents %s outputs as a raw binary body', async (_, schema, jsonSchema) => {
    const doc = await generator.generate({ download: oc.output(schema) })

    expect(doc.paths?.['/download']?.post?.responses?.['200']).toEqual({
      description: 'OK',
      content: { '*/*': { schema: jsonSchema } },
    })
  })

  it('documents each valibot mime type as its own media type', async () => {
    const doc = await generator.generate({
      download: oc.output(v.pipe(v.blob(), v.mimeType(['image/png', 'image/jpeg']))),
    })

    expect(doc.paths?.['/download']?.post?.responses?.['200']).toEqual({
      description: 'OK',
      content: {
        'image/png': { schema: { type: 'string', contentMediaType: 'image/png' } },
        'image/jpeg': { schema: { type: 'string', contentMediaType: 'image/jpeg' } },
      },
    })
  })
})

import { ArkTypeToJsonSchemaConverter } from '@orpc/arktype'
import { oc } from '@orpc/contract'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ValibotToJsonSchemaConverter } from '@orpc/valibot'
import { type } from 'arktype'
import * as v from 'valibot'

describe('openAPIGenerator with file schemas', () => {
  const generator = new OpenAPIGenerator({
    converters: [new ValibotToJsonSchemaConverter(), new ArkTypeToJsonSchemaConverter()],
  })

  it.each([
    [
      'valibot',
      v.object({ avatar: v.pipe(v.file(), v.mimeType(['image/png'])), name: v.string() }),
      'image/png',
    ],
    ['arktype', type({ avatar: 'File', name: 'string' }), '*/*'],
  ])(
    'documents %s inputs with files as a multipart/form-data body',
    async (_, schema, contentMediaType) => {
      const doc = await generator.generate({ upload: oc.input(schema) })

      expect(doc.paths?.['/upload']?.post?.requestBody).toEqual({
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                avatar: { type: 'string', contentMediaType },
                name: { type: 'string' },
              },
              required: ['avatar', 'name'],
            },
          },
        },
      })
    },
  )

  it.each([
    ['valibot blob', v.blob()],
    ['arktype Blob', type('Blob')],
  ])('documents %s outputs as a raw binary body', async (_, schema) => {
    const doc = await generator.generate({ download: oc.output(schema) })

    expect(doc.paths?.['/download']?.post?.responses?.['200']).toEqual({
      description: 'OK',
      content: { '*/*': { schema: { type: 'string', contentMediaType: '*/*' } } },
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

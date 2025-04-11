import type { ZodEffects, ZodType, ZodTypeDef } from 'zod'
import type { CustomParams } from './base'
import wcmatch from 'wildcard-match'
import { custom } from 'zod'
import { composeParams, setCustomZodDef } from './base'

export function file(
  params?: string | CustomParams | ((input: unknown) => CustomParams),
): ZodType<File, ZodTypeDef, File> & {
  type(
    mimeType: string,
    params?: string | CustomParams | ((input: unknown) => CustomParams),
  ): ZodEffects<
    ZodType<File, ZodTypeDef, File>,
    File,
    File
  >
} {
  const schema = custom<File>(
    val => val instanceof File,
    composeParams(
      () => 'Input is not a file',
      params,
    ),
  )

  setCustomZodDef(schema._def, { type: 'file' })

  return Object.assign(schema, {
    type: (
      mimeType: string,
      params?: string | CustomParams | ((input: unknown) => CustomParams),
    ) => {
      const isMatch = wcmatch(mimeType)

      const refinedSchema = schema.refine(
        val => isMatch(val.type.split(';')[0]!),
        composeParams<File>(
          val => `Expected a file of type ${mimeType} but got a file of type ${val.type || 'unknown'}`,
          params,
        ),
      )

      setCustomZodDef(refinedSchema._def, { type: 'file', mimeType })

      return refinedSchema
    },
  })
}

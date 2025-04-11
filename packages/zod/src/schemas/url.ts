import type { ZodType, ZodTypeDef } from 'zod'
import type { CustomParams } from './base'
import { custom } from 'zod'
import { composeParams, setCustomZodDef } from './base'

export function url(
  params?: string | CustomParams | ((input: unknown) => CustomParams),
): ZodType<URL, ZodTypeDef, URL> {
  const schema = custom<URL>(
    val => val instanceof URL,
    composeParams(
      () => 'Input is not a URL',
      params,
    ),
  )

  setCustomZodDef(schema._def, { type: 'url' })

  return schema
}

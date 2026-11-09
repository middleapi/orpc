import { os, type } from '@orpc/server'
import * as z from 'zod'

// @ts-expect-error the module does not exist
import type { Missing } from './round11/missing'

export const errorData = os
  .errors({ GONE: { data: type<{ reason: string }>() } })
  .input(z.object({ a: z.string() }))
  .output(z.object({ b: z.number() }))
  .handler(() => ({ b: 1 }))

/** The procedure's type can not be resolved, though its input and output are convertible */
export const router = { proc: errorData } as unknown as { proc: Missing }

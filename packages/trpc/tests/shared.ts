import type { OpenAPIMeta } from '@orpc/openapi'
import { initTRPC } from '@trpc/server'
import * as z from 'zod'

export const inputSchema = z.object({ input: z.number().transform(n => `${n}`) })

export const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })

export type TRPCContext = { a: string }
export interface TRPCMeta {
  '~openapi'?: OpenAPIMeta
  'meta1'?: string
  'meta2'?: number
}

export const t = initTRPC.context<(req: Request) => (TRPCContext)>().meta<TRPCMeta>().create()

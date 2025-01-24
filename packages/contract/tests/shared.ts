import type { Meta } from '../src/meta'
import { z } from 'zod'
import { ContractProcedure } from '../src'

export const inputSchema = z.object({ input: z.number().transform(n => `${n}`) })

export const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })

export const baseErrorMap = {
  BASE: {
    data: outputSchema,
  },
  OVERRIDE: {},
}

export const baseRoute = { path: '/base' } as const

export type BaseMeta = { mode?: string, log?: boolean }

export const baseMeta: BaseMeta = {
  mode: 'dev',
}

export const ping = new ContractProcedure<
  typeof inputSchema,
  typeof outputSchema,
  typeof baseErrorMap,
  BaseMeta
>({
  inputSchema,
  outputSchema,
  errorMap: baseErrorMap,
  meta: baseMeta,
  route: baseRoute,
})

export const pong = new ContractProcedure<
  undefined,
  undefined,
  Record<never, never>,
  Meta
>({
  errorMap: {},
  inputSchema: undefined,
  outputSchema: undefined,
  meta: {},
  route: {},
})

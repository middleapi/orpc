import type { ProcedureClientOptions } from '@orpc/server'

export interface ClientLink<TClientContext> {
  call: (path: readonly string[], input: unknown, options: ProcedureClientOptions<TClientContext>) => Promise<unknown>
}

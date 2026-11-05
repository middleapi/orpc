import type { Client, ClientContext } from '@orpc/client'
import type { ThrowableError } from '@orpc/shared'

import type { ErrorMap, ORPCErrorFromErrorMap } from './error.ts'
import type { AnySchema, InferSchemaInput, InferSchemaOutput } from './schema.ts'

export type ProcedureContractClient<
  TClientContext extends ClientContext,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
> = Client<
  TClientContext,
  InferSchemaInput<TInputSchema>,
  InferSchemaOutput<TOutputSchema>,
  ORPCErrorFromErrorMap<TErrorMap> | ThrowableError
>

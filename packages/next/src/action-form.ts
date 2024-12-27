import type { Schema, SchemaInput } from '@orpc/contract'
import type { Context, CreateProcedureClientOptions } from '@orpc/server'
import { CompositeSchemaCoercer, OpenAPIPayloadCodec, type PublicOpenAPIPayloadCodec, type SchemaCoercer } from '@orpc/openapi/fetch'
import { createProcedureClient, ORPCError, unlazy } from '@orpc/server'
import { forbidden, notFound, unauthorized } from 'next/navigation'

export type FormAction = (input: FormData) => Promise<void>

export type CreateFormActionOptions = {
  schemaCoercers?: SchemaCoercer[]
  payloadCodec?: PublicOpenAPIPayloadCodec
}

export function createFormAction<
  TContext extends Context,
  TInputSchema extends Schema,
  TOutputSchema extends Schema,
  THandlerOutput extends SchemaInput<TOutputSchema>,
>(opt: CreateProcedureClientOptions<TContext, TInputSchema, TOutputSchema, THandlerOutput> & CreateFormActionOptions): FormAction {
  const caller = createProcedureClient(opt)

  const formAction = async (input: FormData): Promise<void> => {
    try {
      const codec = opt.payloadCodec ?? new OpenAPIPayloadCodec()
      const coercer = new CompositeSchemaCoercer(opt.schemaCoercers ?? [])

      const { default: procedure } = await unlazy(opt.procedure)

      const decodedInput = await codec.decode(input)
      const coercedInput = coercer.coerce(procedure['~orpc'].contract['~orpc'].InputSchema, decodedInput)

      await caller(coercedInput as any)
    }
    catch (e) {
      if (e instanceof ORPCError) {
        if (e.code === 'NOT_FOUND') {
          notFound()
        }

        if (e.code === 'FORBIDDEN') {
          forbidden()
        }

        if (e.code === 'UNAUTHORIZED') {
          unauthorized()
        }
      }

      throw e
    }
  }

  return formAction
}

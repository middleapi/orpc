import type { AnyORPCError, Client, ClientContext } from '@orpc/client'
import type { AnySchema, ErrorMap, InferSchemaInput, InferSchemaOutput, ORPCErrorConstructorMap, ORPCErrorFromErrorMap } from '@orpc/contract'
import type { Interceptor, MaybeOptionalOptions, Promisable, PromiseWithError, ThrowableError, Value, Writable } from '@orpc/shared'
import type { Context } from './context'
import type { Lazyable } from './lazy'
import type { MiddlewareDone } from './middleware'
import type { AnyProcedure, OrderedMiddleware, Procedure, ProcedureHandlerOptions } from './procedure'
import { cloneORPCError, ORPCError, wrapAsyncIteratorPreservingEventMeta } from '@orpc/client'
import { createORPCErrorConstructorMap, reconcileORPCError, ValidationError } from '@orpc/contract'
import { getOpenTelemetryConfig, intercept, isAsyncIteratorObject, isPlainObject, mergeTwoLevels, override, resolveMaybeOptionalOptions, runWithSpan, toArray, traceAsyncIterator, traceReadableStream, value } from '@orpc/shared'
import { Lazy, unlazy } from './lazy'

export type ProcedureClient<
  TClientContext extends ClientContext,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TReturnedORPCError extends AnyORPCError,
> = Client<
  TClientContext,
  InferSchemaInput<TInputSchema>,
  InferSchemaOutput<TOutputSchema>,
  ORPCErrorFromErrorMap<TErrorMap> | TReturnedORPCError | ThrowableError
>

export interface ProcedureClientInterceptorOptions<TInitialContext extends Context, TErrorMap extends ErrorMap> extends ProcedureHandlerOptions<TInitialContext, unknown, ORPCErrorConstructorMap<TErrorMap>> {
}
export type ProcedureClientInterceptor<TInitialContext extends Context, TOutputSchema extends AnySchema, TErrorMap extends ErrorMap, TReturnedError extends AnyORPCError> = Interceptor<
  ProcedureClientInterceptorOptions<TInitialContext, TErrorMap>,
  PromiseWithError<InferSchemaOutput<TOutputSchema>, ORPCErrorFromErrorMap<TErrorMap> | TReturnedError | ThrowableError>
>

export type ProcedureClientOptions<
  TInitialContext extends Context,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TReturnedError extends AnyORPCError,
  TClientContext extends ClientContext,
>
  = & {
    path?: string[]
    interceptors?: ProcedureClientInterceptor<TInitialContext, TOutputSchema, TErrorMap, TReturnedError>[]
  }
  & (
      object extends TInitialContext
        ? { context?: Value<Promisable<TInitialContext>, [clientContext: TClientContext]> }
        : { context: Value<Promisable<TInitialContext>, [clientContext: TClientContext]> }
    )

interface ProcedureCallArtifacts {
  readonly errors: ORPCErrorConstructorMap<any>
  readonly reconcileError: (e: ThrowableError) => Promise<ThrowableError>
}

/**
 * Per-procedure artifacts that never change between calls, so each request
 * stops re-allocating them (the error constructor map allocates a `Proxy`).
 */
const procedureCallArtifacts = new WeakMap<AnyProcedure, ProcedureCallArtifacts>()

function getProcedureCallArtifacts(procedure: AnyProcedure): ProcedureCallArtifacts {
  const cached = procedureCallArtifacts.get(procedure)

  if (cached) {
    return cached
  }

  const artifacts: ProcedureCallArtifacts = {
    errors: createORPCErrorConstructorMap(procedure['~orpc'].errorMap),
    reconcileError: async (e: ThrowableError) => {
      if (e instanceof ORPCError) {
        return await reconcileORPCError(procedure['~orpc'].errorMap, e)
      }

      return e
    },
  }

  procedureCallArtifacts.set(procedure, artifacts)
  return artifacts
}

export function createProcedureClient<
  TInitialContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TReturnedError extends AnyORPCError,
  TClientContext extends ClientContext = object,
>(
  lazyableProcedure: Lazyable<Procedure<TInitialContext, any, TInputSchema, TOutputSchema, TErrorMap, TReturnedError>>,
  ...rest: MaybeOptionalOptions<
    ProcedureClientOptions<
      TInitialContext,
      TOutputSchema,
      TErrorMap,
      TReturnedError,
      TClientContext
    >
  >
): ProcedureClient<TClientContext, TInputSchema, TOutputSchema, TErrorMap, TReturnedError> {
  const options = resolveMaybeOptionalOptions(rest)
  const path = toArray(options.path)

  return async (...[input, callerOptions]) => {
    // `unlazy` allocates and awaits a resolved promise for the common non-lazy case.
    const procedure = lazyableProcedure instanceof Lazy
      ? (await unlazy(lazyableProcedure)).default
      : lazyableProcedure

    // callerOptions.context can be undefined when all field is optional
    const clientContext = callerOptions?.context ?? {} as TClientContext
    // options.context can be undefined when all field is optional
    const context = await value(options.context, clientContext) as TInitialContext | undefined ?? {} as TInitialContext
    const { errors, reconcileError } = getProcedureCallArtifacts(procedure)

    try {
      const output = await runWithSpan('call_procedure', (span) => {
        span?.setAttribute('procedure.path', path)

        return intercept(
          options.interceptors,
          {
            context,
            // input can be optional if it is undefinable
            input: input as InferSchemaInput<TInputSchema>,
            errors,
            path,
            procedure: procedure as AnyProcedure,
            signal: callerOptions?.signal,
            lastEventId: callerOptions?.lastEventId,
          },
          interceptorOptions => executeProcedureInternal(interceptorOptions.procedure, interceptorOptions),
        )
      })

      if (isAsyncIteratorObject(output)) {
        /**
         * traceAsyncIterator/wrapAsyncIteratorPreservingEventMeta return AsyncIteratorClass
         * which is backwards compatible with AsyncIteratorObject.
         *
         * @warning
         * If remove this return, can be breaking change
         * because AsyncIteratorClass convert `.throw` to `.return` (rarely used)
         *
         * @warning
         * Remember use `override` for AsyncIteratorObject to remain other special properties
         */
        return override(output, wrapAsyncIteratorPreservingEventMeta(
          traceAsyncIterator('consume_async_iterator_object_output', output),
          { mapError: reconcileError },
        )) as typeof output
      }

      if ((output as any) instanceof ReadableStream) {
        /**
         * @warning
         * Remember use `override` for ReadableStream to remain other special properties
         */
        return override(output, traceReadableStream('consume_octet_stream_output', output)) as typeof output
      }

      return output
    }
    catch (e) {
      /**
       * Even if the error is inferable (returned), we still need to apply `reconcileError`.
       * Defined errors take priority over inferable errors.
       * `reconcileError` attempts to mark the error as defined, or keeps it inferable if that's not possible.
       */
      throw await reconcileError(e as ThrowableError)
    }
  }
}

type SchemaValidateResult = Awaited<ReturnType<AnySchema['~standard']['validate']>>

function unwrapInput(result: SchemaValidateResult, input: unknown): any {
  if (result.issues) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Input validation failed',
      data: {
        issues: result.issues,
      },
      cause: new ValidationError({
        message: 'Input validation failed',
        issues: result.issues,
        invalidData: input,
      }),
    })
  }

  return result.value
}

function unwrapOutput(result: SchemaValidateResult, output: unknown): any {
  if (result.issues) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'Output validation failed',
      cause: new ValidationError({
        message: 'Output validation failed',
        issues: result.issues,
        invalidData: output,
      }),
    })
  }

  return result.value
}

async function validateInput(traced: boolean, i: number, schema: AnySchema, input: unknown): Promise<any> {
  if (!traced) {
    return unwrapInput(await schema['~standard'].validate(input), input)
  }

  return runWithSpan(`validate_input.${i}`, async (span) => {
    span?.setAttribute('input_schema.index', i)

    return unwrapInput(await schema['~standard'].validate(input), input)
  })
}

async function validateOutput(traced: boolean, i: number, schema: AnySchema, output: unknown): Promise<any> {
  if (!traced) {
    return unwrapOutput(await schema['~standard'].validate(output), output)
  }

  return runWithSpan(`validate_output.${i}`, async (span) => {
    span?.setAttribute('output_schema.index', i)

    return unwrapOutput(await schema['~standard'].validate(output), output)
  })
}

const middlewareDone: MiddlewareDone<any> = (...rest) => {
  const options = resolveMaybeOptionalOptions(rest)

  return {
    output: options.output,
    // context can be undefined when all field is optional
    context: options.context ?? {} as any,
  }
}

interface ProcedureExecutionPlan {
  readonly orderedMiddlewares: OrderedMiddleware[]
  readonly inputSchemas: AnySchema[]
  readonly outputSchemas: AnySchema[]
  /**
   * Per-level input/output schema slice boundaries (`length` = middleware count + 1,
   * the last entry being the handler level), precomputed from the snapshots
   * taken when each middleware was used.
   */
  readonly inputStarts: number[]
  readonly inputEnds: number[]
  readonly outputStarts: number[]
  readonly outputEnds: number[]
  readonly validateInputs: boolean
  readonly validateOutputs: boolean
  readonly stackedObjectInputs: boolean
}

const executionPlans = new WeakMap<AnyProcedure, ProcedureExecutionPlan>()

function getExecutionPlan(procedure: AnyProcedure): ProcedureExecutionPlan {
  const cached = executionPlans.get(procedure)

  if (cached) {
    return cached
  }

  const def = procedure['~orpc']
  const inputSchemas = toArray(def.inputSchemas)
  const outputSchemas = toArray(def.outputSchemas)
  const orderedMiddlewares = def.orderedMiddlewares

  const levels = orderedMiddlewares.length + 1
  const inputStarts: number[] = []
  const inputEnds: number[] = []
  const outputStarts: number[] = []
  const outputEnds: number[] = []

  let hasInputs = false
  let hasOutputs = false

  for (let level = 0; level < levels; level++) {
    const isHandler = level === orderedMiddlewares.length
    const prev = level === 0 ? undefined : orderedMiddlewares[level - 1]!
    const curr = isHandler ? undefined : orderedMiddlewares[level]!

    const inputStart = prev?.inputSchemasLengthAtUse ?? 0
    const inputEnd = isHandler ? inputSchemas.length : curr!.inputSchemasLengthAtUse ?? 0
    const outputStart = prev?.outputSchemasLengthAtUse ?? 0
    const outputEnd = isHandler ? outputSchemas.length : curr!.outputSchemasLengthAtUse ?? 0

    inputStarts.push(inputStart)
    inputEnds.push(inputEnd)
    outputStarts.push(outputStart)
    outputEnds.push(outputEnd)
    hasInputs ||= inputEnd > inputStart
    hasOutputs ||= outputEnd > outputStart
  }

  const plan: ProcedureExecutionPlan = {
    orderedMiddlewares,
    inputSchemas,
    outputSchemas,
    inputStarts,
    inputEnds,
    outputStarts,
    outputEnds,
    validateInputs: hasInputs && !def.disableInputValidation,
    validateOutputs: hasOutputs && !def.disableOutputValidation,
    stackedObjectInputs: inputSchemas.length > 1,
  }

  executionPlans.set(procedure, plan)
  return plan
}

/**
 * `for...in` with an early exit is the cheapest "has own enumerable keys" check;
 * skipping the spread entirely beats copying an empty override into the context.
 * The `hasOwnProperty` guard mirrors what `{ ...context, ...next }` would copy.
 */
function hasEnumerableProperties(context: Context | undefined): boolean {
  if (context === undefined) {
    return false
  }

  for (const key in context) {
    if (Object.hasOwn(context, key)) {
      return true
    }
  }

  // `for...in` misses symbol keys, which object spread does copy
  // (e.g. rate limit bookkeeping passed through middleware context).
  return Object.getOwnPropertySymbols(context).length > 0
}

async function executeProcedureInternal(procedure: AnyProcedure, options: ProcedureHandlerOptions<any, any, any>): Promise<any> {
  const plan = getExecutionPlan(procedure)
  const traced = getOpenTelemetryConfig()?.tracer !== undefined

  const next = async (
    midIndex: number,
    context: Context,
    input: unknown,
  ): Promise<{ output: unknown, context: Record<any, any> }> => {
    let currentInput = input

    if (plan.validateInputs) {
      const inputSchemas = plan.inputSchemas
      const stackedObjectInputs = plan.stackedObjectInputs

      for (let i = plan.inputStarts[midIndex]!; i < plan.inputEnds[midIndex]!; i++) {
        const validated = await validateInput(
          traced,
          i,
          inputSchemas[i]!,
          stackedObjectInputs && isPlainObject(currentInput) ? options.input : currentInput,
        )

        currentInput = i !== 0 ? mergeTwoLevels(currentInput, validated) : validated
      }
    }

    let currentOutput: unknown
    let currentContext = context

    if (midIndex < plan.orderedMiddlewares.length) {
      const { middleware } = plan.orderedMiddlewares[midIndex]!

      const invoke = () => middleware(
        {
          ...options,
          context,
          next: (...rest) => {
            const nextContext = rest.length === 0 ? undefined : rest[0]?.context

            return next(
              midIndex + 1,
              nextContext !== undefined && hasEnumerableProperties(nextContext)
                ? { ...context, ...nextContext }
                : context,
              currentInput,
            )
          },
          lastEventId: options.lastEventId,
        },
        currentInput,
        middlewareDone,
      )

      const result = traced
        ? await runWithSpan(`middleware.${middleware.name}`, async (span) => {
            span?.setAttribute('middleware.index', midIndex)

            return await invoke()
          })
        : await invoke()

      currentOutput = result.output

      const resultContext = result.context
      currentContext = resultContext !== undefined && hasEnumerableProperties(resultContext)
        ? { ...context, ...resultContext }
        : context
    }
    else {
      const handler = procedure['~orpc'].handler

      currentOutput = traced
        ? await runWithSpan(
            'handler',
            () => handler({ ...options, context, input: currentInput }, currentInput),
          )
        : await handler({ ...options, context, input: currentInput }, currentInput)

      /**
       * `ORPCError` is always an object, so primitives skip the
       * prototype-chain-walking `Symbol.hasInstance` on the happy path.
       */
      if (typeof currentOutput === 'object' && currentOutput !== null && currentOutput instanceof ORPCError) {
        if (procedure['~orpc'].opaqueReturnedErrors) {
          throw currentOutput
        }

        if (currentOutput.inferable && !currentOutput.defined) {
          throw currentOutput
        }

        const error = cloneORPCError(currentOutput)

        ;(error.defined as Writable<typeof error.defined>) = false
        ;(error.inferable as Writable<typeof error.inferable>) = true

        throw error
      }
    }

    if (plan.validateOutputs) {
      const outputSchemas = plan.outputSchemas

      for (let i = plan.outputEnds[midIndex]! - 1; i >= plan.outputStarts[midIndex]!; i--) {
        currentOutput = await validateOutput(traced, i, outputSchemas[i]!, currentOutput)
      }
    }

    return { output: currentOutput, context: currentContext }
  }

  const { output } = await next(0, options.context, options.input)
  return output
}

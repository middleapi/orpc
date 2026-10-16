import type { Schema } from '@orpc/contract'
import type { SchemaAST } from 'effect'
import { getHiddenMetaPlugins, setHiddenMetaPlugins } from '@orpc/contract'
import { Cause, Effect, Schema as EffectSchema, Exit, Scheduler, SchemaIssue, SchemaParser } from 'effect'

/**
 * Converts an Effect schema into a Standard Schema that oRPC can use for validation.
 *
 * The original schema is left untouched: the result is a new schema instance with the same AST.
 * Decoding failures are reported as validation issues, while defects (such as a transformation
 * or check that throws) are rethrown, so oRPC reports them as internal server errors
 * instead of exposing their details to clients.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#effect-schema | Effect Integration - Effect Schema}
 */
export function toStandardSchema<S extends EffectSchema.ConstraintDecoder<any>>(
  schema: S,
): Schema<S['Encoded'], S['Type']> & S {
  const converted: any = EffectSchema.isSchema(schema)
    ? schema.rebuild(schema.ast)
    : EffectSchema.make(schema.ast)

  const decode = SchemaParser.decodeUnknownEffect(schema)
  const parseOptions: SchemaAST.ParseOptions = { errors: 'all' }
  const formatter = SchemaIssue.makeFormatterStandardSchemaV1()

  const validate = (value: unknown) => {
    const fiber = Effect.runFork(
      Effect.match(decode(value, parseOptions), {
        onFailure: formatter,
        onSuccess: value => ({ value }),
      }),
      { scheduler: new Scheduler.MixedScheduler('sync') },
    )

    fiber.currentDispatcher.flush()
    const exit = fiber.pollUnsafe()

    if (exit) {
      return unwrapValidationExit(exit)
    }

    return new Promise((resolve, reject) => {
      fiber.addObserver((exit) => {
        try {
          resolve(unwrapValidationExit(exit))
        }
        catch (error) {
          reject(error)
        }
      })
    })
  }

  converted['~standard'] = {
    // keeps other Standard Schema props (e.g. from `Schema.toStandardJSONSchemaV1`)
    ...(Object.hasOwn(schema, '~standard') ? (schema as any)['~standard'] : undefined),
    version: 1,
    vendor: 'effect',
    validate,
  }

  const metaPlugins = getHiddenMetaPlugins(schema)
  if (metaPlugins) {
    setHiddenMetaPlugins(converted, metaPlugins)
  }

  return converted
}

function unwrapValidationExit<T>(exit: Exit.Exit<T>): T {
  if (Exit.isSuccess(exit)) {
    return exit.value
  }

  /**
   * Schema issues are already formatted into the success channel, so a failure here is a defect
   * or an interruption. Throw it so it is never sent to clients as a validation issue.
   */
  throw Cause.squash(exit.cause)
}

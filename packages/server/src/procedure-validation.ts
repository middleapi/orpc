import type { ProcedureConfig, ProcedureValidationOptions } from './procedure.ts'

/**
 * Merges two `validation` settings, so `override` only replaces the directions it sets.
 */
export function mergeProcedureValidation(
  base: ProcedureConfig['validation'],
  override: ProcedureConfig['validation'],
): ProcedureConfig['validation'] {
  if (base === undefined) {
    return override
  }

  if (override === undefined) {
    return base
  }

  const resolvedBase = toValidationOptions(base)
  const resolvedOverride = toValidationOptions(override)

  return {
    input: resolvedOverride.input ?? resolvedBase.input,
    output: resolvedOverride.output ?? resolvedBase.output,
  }
}

/**
 * Resolves a `validation` setting to whether each direction is validated.
 */
export function resolveProcedureValidation(validation: ProcedureConfig['validation']): {
  input: boolean
  output: boolean
} {
  const options = toValidationOptions(validation)

  return {
    input: options.input ?? true,
    output: options.output ?? true,
  }
}

function toValidationOptions(
  validation: ProcedureConfig['validation'],
): ProcedureValidationOptions {
  return typeof validation === 'object' ? validation : { input: validation, output: validation }
}

import { mergeProcedureValidation, resolveProcedureValidation } from './procedure-validation.ts'

describe('mergeProcedureValidation', () => {
  it('keeps the other side when one is undefined', () => {
    expect(mergeProcedureValidation(undefined, undefined)).toBeUndefined()
    expect(mergeProcedureValidation(false, undefined)).toBe(false)
    expect(mergeProcedureValidation(undefined, { input: false })).toEqual({ input: false })
  })

  it('only overrides the directions the override sets', () => {
    expect(mergeProcedureValidation({ input: false }, { output: false })).toEqual({
      input: false,
      output: false,
    })
    expect(mergeProcedureValidation(false, { input: true })).toEqual({ input: true, output: false })
    expect(mergeProcedureValidation({ input: false }, true)).toEqual({ input: true, output: true })
    expect(mergeProcedureValidation(false, {})).toEqual({ input: false, output: false })
  })
})

describe('resolveProcedureValidation', () => {
  it('validates both directions by default', () => {
    expect(resolveProcedureValidation(undefined)).toEqual({ input: true, output: true })
    expect(resolveProcedureValidation(true)).toEqual({ input: true, output: true })
    expect(resolveProcedureValidation({})).toEqual({ input: true, output: true })
  })

  it('disables the directions set to false', () => {
    expect(resolveProcedureValidation(false)).toEqual({ input: false, output: false })
    expect(resolveProcedureValidation({ input: false })).toEqual({ input: false, output: true })
    expect(resolveProcedureValidation({ output: false })).toEqual({ input: true, output: false })
  })
})

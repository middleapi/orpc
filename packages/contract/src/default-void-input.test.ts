import { z } from 'zod'
import { oc } from './builder'
import { isContractProcedure } from './procedure'

describe('default void input - contract', () => {
  it('should be a valid contract procedure', () => {
    const contract = oc
      .output(z.string())

    expect(isContractProcedure(contract)).toBe(true)
  })

  it('should work with explicit void input same as default', () => {
    const contractWithoutInput = oc
      .output(z.string())

    const contractWithVoidInput = oc
      .input(z.void())
      .output(z.string())

    expect(isContractProcedure(contractWithoutInput)).toBe(true)
    expect(isContractProcedure(contractWithVoidInput)).toBe(true)
  })

  it('should still work with explicit input schema', () => {
    const contract = oc
      .input(z.object({ name: z.string() }))
      .output(z.string())

    const inputSchema = contract['~orpc'].inputSchema

    expect(inputSchema).toBeDefined()
    expect(inputSchema?.['~standard'].vendor).toBe('zod')
  })

  it('should work in contract router without input()', () => {
    const contractRouter = {
      getAll: oc
        .output(z.array(z.string())),
      getOne: oc
        .input(z.object({ id: z.string() }))
        .output(z.string()),
    }

    expect(isContractProcedure(contractRouter.getAll)).toBe(true)
    expect(isContractProcedure(contractRouter.getOne)).toBe(true)
    expect(contractRouter.getOne['~orpc'].inputSchema).toBeDefined()
  })

  it('should allow metadata chaining with default void input', () => {
    const contract = oc
      .meta({ description: 'A test procedure' })
      .output(z.string())

    expect(isContractProcedure(contract)).toBe(true)
    expect(contract['~orpc'].meta).toEqual({ description: 'A test procedure' })
  })

  it('should allow route definition with default void input', () => {
    const contract = oc
      .route({ method: 'GET', path: '/test' })
      .output(z.string())

    expect(isContractProcedure(contract)).toBe(true)
    expect(contract['~orpc'].route).toEqual({ method: 'GET', path: '/test' })
  })

  it('should allow error mapping with default void input', () => {
    const contract = oc
      .errors({ NOT_FOUND: z.object({ message: z.string() }) })
      .output(z.string())

    expect(isContractProcedure(contract)).toBe(true)
    expect(contract['~orpc'].errorMap).toHaveProperty('NOT_FOUND')
  })
})

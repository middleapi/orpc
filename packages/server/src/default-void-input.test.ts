import { z } from 'zod'
import { os } from './builder'

describe('default void input', () => {
  it('should accept no input when input() is not specified', async () => {
    const procedure = os
      .output(z.string())
      .handler(() => 'result')

    // Should work without providing input
    const result = await procedure['~orpc'].handler({
      context: {},
      input: undefined,
      rawInput: undefined,
    })

    expect(result).toBe('result')
  })

  it('should accept undefined as input when input() is not specified', async () => {
    const procedure = os
      .output(z.string())
      .handler(() => 'result')

    // Should work with undefined input
    const result = await procedure['~orpc'].handler({
      context: {},
      input: undefined,
      rawInput: undefined,
    })

    expect(result).toBe('result')
  })

  it('should work with explicit void input same as default', async () => {
    const procedureWithoutInput = os
      .output(z.string())
      .handler(() => 'result1')

    const procedureWithVoidInput = os
      .input(z.void())
      .output(z.string())
      .handler(() => 'result2')

    const result1 = await procedureWithoutInput['~orpc'].handler({
      context: {},
      input: undefined,
      rawInput: undefined,
    })

    const result2 = await procedureWithVoidInput['~orpc'].handler({
      context: {},
      input: undefined,
      rawInput: undefined,
    })

    expect(result1).toBe('result1')
    expect(result2).toBe('result2')
  })

  it('should still work with explicit input schema', async () => {
    const procedure = os
      .input(z.object({ name: z.string() }))
      .output(z.string())
      .handler(({ input }) => `Hello ${input.name}`)

    const result = await procedure['~orpc'].handler({
      context: {},
      input: { name: 'World' },
      rawInput: { name: 'World' },
    })

    expect(result).toBe('Hello World')
  })

  it('should work after use() without explicit input()', async () => {
    const middleware = ({ next }) => next()

    const procedure = os
      .use(middleware)
      .output(z.string())
      .handler(() => 'result after middleware')

    const result = await procedure['~orpc'].handler({
      context: {},
      input: undefined,
      rawInput: undefined,
    })

    expect(result).toBe('result after middleware')
  })

  it('should work in router without input()', async () => {
    const testRouter = {
      getAll: os
        .output(z.array(z.string()))
        .handler(() => ['item1', 'item2']),
      getOne: os
        .input(z.object({ id: z.string() }))
        .output(z.string())
        .handler(({ input }) => `Item: ${input.id}`),
    }

    const result1 = await testRouter.getAll['~orpc'].handler({
      context: {},
      input: undefined,
      rawInput: undefined,
    })

    const result2 = await testRouter.getOne['~orpc'].handler({
      context: {},
      input: { id: '123' },
      rawInput: { id: '123' },
    })

    expect(result1).toEqual(['item1', 'item2'])
    expect(result2).toBe('Item: 123')
  })
})

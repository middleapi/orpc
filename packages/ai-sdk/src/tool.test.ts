import { asyncIteratorObject, oc, type } from '@orpc/contract'
import { os } from '@orpc/server'
import z from 'zod'
import { createToolFactory, implementToolFactory } from './tool'
import { aiSdkTool } from './tool-meta'

describe('implementToolFactory', () => {
  const inputSchema = z.object({
    name: z.string().describe('Name of the person'),
  })
  const outputSchema = z.object({
    greeting: z.string().describe('Greeting message'),
  })

  it('can implement a tool', () => {
    const contract = oc
      .meta(aiSdkTool({ description: 'Greet a person' }))
      .input(inputSchema)
      .output(outputSchema)

    const execute = vi.fn()

    const tool = implementToolFactory()(contract, {
      execute,
    })

    expect(tool.inputSchema).toBe(inputSchema)
    expect(tool.outputSchema).toBe(outputSchema)
    expect(tool.description).toBe('Greet a person')
    expect(tool.execute).toBe(execute)
  })

  it('use a schema that accepts anything when contract has no input schema', async () => {
    const tool = implementToolFactory()(oc)
    const schema = tool.inputSchema as any

    expect(schema['~standard'].validate({ anything: true })).toEqual({ value: { anything: true } })
    expect(schema['~standard'].jsonSchema.input({ target: 'draft-07' })).toEqual({})
    expect(schema['~standard'].jsonSchema.output({ target: 'draft-07' })).toEqual({})
  })

  it('can build multiple tools from the same factory', () => {
    const implement = implementToolFactory()

    const tool1 = implement(oc.input(inputSchema), { description: 'First tool' })
    const tool2 = implement(oc.input(inputSchema).output(outputSchema), { description: 'Second tool' })

    expect(tool1.description).toBe('First tool')
    expect(tool2.description).toBe('Second tool')
    expect(tool2.outputSchema).toBe(outputSchema)
  })

  it('support aiSdkTool meta to provide default tool options', () => {
    const contract = oc
      .meta(
        aiSdkTool({ metadata: { source: 'weather-service' }, description: 'Meta description' }),
      )
      .input(inputSchema)

    const tool = implementToolFactory()(contract, {
      execute: vi.fn(),
      description: 'Override description',
    })

    expect(tool.metadata).toEqual({ source: 'weather-service' })
    expect(tool.description).toBe('Override description')

    expect(implementToolFactory()(contract).description).toBe('Meta description')
  })

  describe('multiple schemas', () => {
    const extraInputSchema = z.looseObject({
      age: z.number().describe('Age of the person'),
    })

    it('combines input schemas by piping validation in order', async () => {
      const contract = oc
        .input(z.looseObject({ name: z.string() }))
        .input(extraInputSchema)

      const tool = implementToolFactory()(contract)
      const combined = tool.inputSchema as any

      expect(combined).not.toBe(extraInputSchema)

      await expect(
        combined['~standard'].validate({ name: 'Alice', age: 18 }),
      ).resolves.toEqual({ value: { name: 'Alice', age: 18 } })

      const failed = await combined['~standard'].validate({ name: 'Alice' })
      expect(failed.issues).toEqual([expect.objectContaining({ path: ['age'] })])
    })

    it('combines input json schemas with allOf and hoists $schema to the root', () => {
      const contract = oc
        .input(z.looseObject({ name: z.string() }))
        .input(extraInputSchema)

      const tool = implementToolFactory()(contract)
      const combined = tool.inputSchema as any

      for (const direction of ['input', 'output'] as const) {
        const jsonSchema = combined['~standard'].jsonSchema[direction]({ target: 'draft-07' })

        expect(jsonSchema).toEqual({
          $schema: 'http://json-schema.org/draft-07/schema#',
          allOf: [
            expect.objectContaining({ required: ['name'] }),
            expect.objectContaining({ required: ['age'] }),
          ],
        })

        expect(jsonSchema.allOf.every((branch: any) => !('$schema' in branch))).toBe(true)
      }
    })

    it('promotes $defs to the root and rewrites $ref pointers', () => {
      const jsonSchemaSupportedSchema = (jsonSchema: Record<string, unknown>) => ({
        '~standard': {
          vendor: 'custom',
          version: 1,
          validate: (value: unknown) => ({ value }),
          jsonSchema: {
            input: () => jsonSchema,
            output: () => jsonSchema,
          },
        },
      }) as any

      const contract = oc
        .input(jsonSchemaSupportedSchema({
          $defs: { user: { type: 'object' } },
          $ref: '#/$defs/user',
        }))
        .input(jsonSchemaSupportedSchema({
          $defs: { user: { type: 'string' } },
          properties: { friend: { $ref: '#/$defs/user' }, self: { $ref: '#' } },
        }))

      const tool = implementToolFactory()(contract)
      const combined = tool.inputSchema as any

      expect(combined['~standard'].jsonSchema.input({ target: 'draft-07' })).toEqual({
        $defs: {
          user: { type: 'object' },
          user2: { type: 'string' },
        },
        allOf: [
          { $ref: '#/$defs/user' },
          { properties: { friend: { $ref: '#/$defs/user2' }, self: { $ref: '#/allOf/1' } } },
        ],
      })
    })

    it('converts json schema using only the schemas that support it', () => {
      const contract = oc
        .input(z.looseObject({ name: z.string() }))
        .input(type<{ age: number }>())

      const tool = implementToolFactory()(contract)
      const combined = tool.inputSchema as any

      expect(combined['~standard'].jsonSchema.input({ target: 'draft-07' })).toEqual(
        expect.objectContaining({ required: ['name'] }),
      )
    })

    it('omits json schema conversion when no schema supports it', () => {
      const contract = oc
        .input(type<{ name: string }>())
        .input(type<{ age: number }>())

      const tool = implementToolFactory()(contract)
      const combined = tool.inputSchema as any

      expect(combined['~standard'].jsonSchema).toBeUndefined()
    })

    it('combines output schemas by piping validation in reverse order', async () => {
      const order: string[] = []

      const contract = oc
        .input(inputSchema)
        .output(type<{ greeting: string }>((value) => {
          order.push('first')
          return value
        }))
        .output(type<{ greeting: string }>((value) => {
          order.push('second')
          return value
        }))

      const tool = implementToolFactory()(contract)
      const combined = tool.outputSchema as any

      await expect(
        combined['~standard'].validate({ greeting: 'Hello, Alice!' }),
      ).resolves.toEqual({ value: { greeting: 'Hello, Alice!' } })

      expect(order).toEqual(['second', 'first'])
    })
  })

  describe('async iterator output schema', () => {
    const yieldSchema = z.object({ message: z.string() })
    const returnSchema = z.object({ count: z.number() })

    it('use yield schema as output schema', () => {
      expect(
        implementToolFactory()(oc.input(inputSchema).output(asyncIteratorObject(yieldSchema))).outputSchema,
      ).toBe(yieldSchema)

      expect(
        implementToolFactory()(oc.input(inputSchema).output(asyncIteratorObject(yieldSchema, returnSchema))).outputSchema,
      ).toBe(yieldSchema)
    })
  })
})

describe('createToolFactory', () => {
  const abortSignal = (new AbortController()).signal

  const inputSchema = z.object({
    name: z.string().describe('Name of the person'),
  })
  const outputSchema = z.object({
    greeting: z.string().describe('Greeting message'),
  })

  it('can create a tool', async () => {
    const handler = vi.fn(async ({ input }) => {
      return {
        greeting: `Hello, ${input.name}!`,
      }
    })

    const procedure = os
      .$context<{ authToken: string }>()
      .meta(aiSdkTool({ description: 'Greet a person' }))
      .input(inputSchema)
      .output(outputSchema)
      .handler(handler)

    const tool = createToolFactory({
      context: { authToken: 'auth-token' },
    })(procedure)

    expect(tool.inputSchema).toBe(inputSchema)
    expect(tool.outputSchema).toBe(outputSchema)
    expect(tool.description).toBe('Greet a person')

    await expect((tool as any).execute({ name: 'Alice' }, { abortSignal })).resolves.toEqual({ greeting: 'Hello, Alice!' })

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      signal: abortSignal,
      input: { name: 'Alice' },
      context: { authToken: 'auth-token' },
    }), { name: 'Alice' })
  })

  it('accepts ai sdk tool options in the factory result', async () => {
    const procedure = os
      .input(inputSchema)
      .output(outputSchema)
      .handler(async ({ input }) => ({ greeting: `Hello, ${input.name}!` }))

    const build = createToolFactory()

    const tool = build(procedure, {
      description: 'Custom description',
      metadata: { source: 'weather-service' },
    })

    expect(tool.description).toBe('Custom description')
    expect(tool.metadata).toEqual({ source: 'weather-service' })
  })

  it('disable validation at oRPC level to avoid twice times validation', async () => {
    const procedure = os
      .input(inputSchema)
      .output(outputSchema)
      .handler(({ input }) => input as any)

    const tool = createToolFactory()(procedure)

    await expect(tool.execute?.('invalid' as any, { abortSignal } as any)).resolves.toEqual('invalid')
  })

  describe('async iterator output', () => {
    const yieldSchema = z.object({ message: z.string() })
    const returnSchema = z.object({ count: z.number() })

    it('streams events, ignoring the return value', async () => {
      const procedure = os
        .input(inputSchema)
        .output(asyncIteratorObject(yieldSchema, returnSchema))
        .handler(async function* () {
          yield { message: 'one' }
          yield { message: 'two' }
          return { count: 2 }
        })

      const tool = createToolFactory()(procedure)

      const outputs: unknown[] = []
      for await (const output of (tool as any).execute({ name: 'Alice' }, { abortSignal })) {
        outputs.push(output)
      }

      expect(outputs).toEqual([{ message: 'one' }, { message: 'two' }])
    })

    it('closes the iterator when the consumer stops early', async () => {
      let finallyCalled = false

      const procedure = os
        .input(inputSchema)
        .output(asyncIteratorObject(yieldSchema))
        .handler(async function* () {
          try {
            yield { message: 'one' }
            yield { message: 'two' }
          }
          finally {
            finallyCalled = true
          }
        })

      const tool = createToolFactory()(procedure)

      const iterator = (tool as any).execute({ name: 'Alice' }, { abortSignal })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { message: 'one' } })
      await iterator.return()

      expect(finallyCalled).toBe(true)
    })

    it('yields non-iterator output once when handler ignores the declared iterator schema', async () => {
      const procedure = os
        .input(inputSchema)
        .output(asyncIteratorObject(yieldSchema))
        .handler(async () => ({ message: 'not an iterator' }) as any)

      const tool = createToolFactory()(procedure)

      const outputs: unknown[] = []
      for await (const output of (tool as any).execute({ name: 'Alice' }, { abortSignal })) {
        outputs.push(output)
      }

      expect(outputs).toEqual([{ message: 'not an iterator' }])
    })
  })
})

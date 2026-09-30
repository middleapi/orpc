import type { ModelMessage, ToolSet, UIMessage } from 'ai'
import { asyncIteratorObject, oc, type } from '@orpc/contract'
import { os } from '@orpc/server'
import { asSchema, convertToModelMessages, generateText, streamText } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
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
    const implementTool = implementToolFactory()

    const tool1 = implementTool(oc.input(inputSchema), { description: 'First tool' })
    const tool2 = implementTool(oc.input(inputSchema).output(outputSchema), { description: 'Second tool' })

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

    it('combines input schemas by merging what each one validates', async () => {
      const contract = oc
        .input(z.object({ name: z.string() }))
        .input(z.object({ age: z.number().describe('Age of the person') }))

      const tool = implementToolFactory()(contract)
      const combined = tool.inputSchema as any

      /**
       * Both schemas strip the fragment declared by the other, so each must see the original value,
       * not only what the previous one returned.
       */
      await expect(
        combined['~standard'].validate({ name: 'Alice', age: 18, unknown: true }),
      ).resolves.toEqual({ value: { name: 'Alice', age: 18 } })

      const failed = await combined['~standard'].validate({ name: 'Alice' })
      expect(failed.issues).toEqual([expect.objectContaining({ path: ['age'] })])
    })

    it('combines input schema fragments nested one level deep', async () => {
      const contract = oc
        .input(z.object({ params: z.object({ id: z.string() }) }))
        .input(z.object({ params: z.object({ slug: z.string() }), query: z.object({ page: z.number() }) }))

      const tool = implementToolFactory()(contract)
      const combined = tool.inputSchema as any

      await expect(
        combined['~standard'].validate({
          params: { id: 'ID', slug: 'SLUG', unknown: true },
          query: { page: 1 },
        }),
      ).resolves.toEqual({
        value: {
          params: { id: 'ID', slug: 'SLUG' },
          query: { page: 1 },
        },
      })
    })

    it('keeps earlier transforms when a later input schema passes the raw values through', async () => {
      const contract = oc
        .input(z.object({ id: z.coerce.number() }))
        .input(z.looseObject({ name: z.string() }))

      const tool = implementToolFactory()(contract)
      const combined = tool.inputSchema as any

      await expect(
        combined['~standard'].validate({ id: '5', name: 'NAME' }),
      ).resolves.toEqual({ value: { id: 5, name: 'NAME' } })
    })

    it('combines non-object input schemas by piping validation in order', async () => {
      const contract = oc
        .input(type<string, string>(value => `first__${value}`))
        .input(type<string, string>(value => `second__${value}`))

      const tool = implementToolFactory()(contract)
      const combined = tool.inputSchema as any

      await expect(
        combined['~standard'].validate('INPUT'),
      ).resolves.toEqual({ value: 'second__first__INPUT' })
    })

    it('combines input json schemas with allOf and hoists $schema to the root', () => {
      const contract = oc
        .input(z.object({ name: z.string() }))
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
        .input(z.object({ name: z.string() }))
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

  it('the AI SDK does not validate execute results against outputSchema, so oRPC must validate output itself', async () => {
    const contract = oc.input(inputSchema).output(outputSchema)

    const greet = implementToolFactory()(contract, {
      execute: async () => ({ greeting: 123 }) as any,
    })

    const result = await generateText({
      model: new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'greet',
            input: JSON.stringify({ name: 'Alice' }),
          }],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        }),
      }),
      tools: { greet },
      prompt: 'Greet Alice',
    })

    expect(result.toolResults).toEqual([
      expect.objectContaining({ output: { greeting: 123 } }),
    ])
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

    expect(asSchema(tool.inputSchema).jsonSchema).toEqual(asSchema(inputSchema).jsonSchema)
    expect(tool.outputSchema).toBe(outputSchema)
    expect(tool.description).toBe('Greet a person')

    await expect((tool as any).execute({ name: 'Alice' }, { abortSignal })).resolves.toEqual({ greeting: 'Hello, Alice!' })

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      signal: abortSignal,
      input: { name: 'Alice' },
      context: { authToken: 'auth-token' },
    }), { name: 'Alice' })
  })

  it('always passes the tool call signal to the procedure', async () => {
    const signals: (AbortSignal | undefined)[] = []

    const procedure = os
      .input(inputSchema)
      .output(outputSchema)
      .handler(({ input, signal }) => {
        signals.push(signal)
        return { greeting: `Hello, ${input.name}!` }
      })

    const streamingProcedure = os
      .input(inputSchema)
      .handler(async function* ({ input, signal }) {
        signals.push(signal)
        yield { greeting: `Hello, ${input.name}!` }
      })

    const createTool = createToolFactory({ signal: undefined } as any)

    await (createTool(procedure) as any).execute({ name: 'Alice' }, { abortSignal })
    for await (const _ of (createTool(streamingProcedure) as any).execute({ name: 'Alice' }, { abortSignal })) {
      // consume
    }

    expect(signals).toEqual([abortSignal, abortSignal])
  })

  it('accepts ai sdk tool options in the factory result', async () => {
    const procedure = os
      .input(inputSchema)
      .output(outputSchema)
      .handler(async ({ input }) => ({ greeting: `Hello, ${input.name}!` }))

    const createTool = createToolFactory()

    const tool = createTool(procedure, {
      description: 'Custom description',
      metadata: { source: 'weather-service' },
    })

    expect(tool.description).toBe('Custom description')
    expect(tool.metadata).toEqual({ source: 'weather-service' })
  })

  describe('input validation', () => {
    const usage = {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    }

    function createModel(toolCall?: { toolName: string, input: unknown }) {
      const content = toolCall
        ? [{ type: 'tool-call' as const, toolCallId: 'call-1', toolName: toolCall.toolName, input: JSON.stringify(toolCall.input) }]
        : []
      const finishReason = { unified: toolCall ? 'tool-calls' as const : 'stop' as const, raw: undefined }

      return new MockLanguageModelV4({
        doGenerate: async () => ({ content, finishReason, usage, warnings: [] }),
        doStream: async () => ({
          stream: convertArrayToReadableStream([...content, { type: 'finish' as const, finishReason, usage }]),
        }),
      })
    }

    /**
     * Without `experimental_toolApprovalSecret`, the client controls this history. The AI SDK only checks
     * the approved input against the tool's `inputSchema`, then executes the tool with the raw input.
     */
    function createApprovedHistory(toolName: string, input: unknown): UIMessage[] {
      return [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
        {
          id: 'a1',
          role: 'assistant',
          parts: [{
            type: `tool-${toolName}`,
            toolCallId: 'call-1',
            state: 'approval-responded',
            input,
            approval: { id: 'approval-1', approved: true },
          }],
        },
      ]
    }

    describe.each(['generateText', 'streamText'] as const)('with %s', (api) => {
      async function run(options: { model: MockLanguageModelV4, tools: ToolSet, messages: ModelMessage[] }) {
        if (api === 'generateText') {
          await generateText(options)
        }
        else {
          await streamText(options).consumeStream()
        }
      }

      it('validates input of approved tool calls resumed from message history', async () => {
        const handler = vi.fn(async ({ input }) => input)

        const updateProfile = os
          .input(z.object({ displayName: z.string().trim().max(20) }))
          .handler(handler)

        const tools = { updateProfile: createToolFactory()(updateProfile) }

        await run({
          model: createModel(),
          tools,
          messages: await convertToModelMessages(
            createApprovedHistory('updateProfile', { displayName: '  Mallory  ', role: 'admin' }),
            { tools },
          ),
        })

        expect(handler).toHaveBeenCalledOnce()
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({ input: { displayName: 'Mallory' } }),
          { displayName: 'Mallory' },
        )
      })

      describe('applies non-idempotent input transforms once', () => {
        const handler = vi.fn(async ({ input }) => input)

        const procedure = os
          .input(z.object({ name: z.string().transform(name => `${name}!`) }))
          .input(z.object({ age: z.number() }))
          .handler(handler)

        const tools = { greet: createToolFactory()(procedure) }
        const expected = { name: 'Alice!', age: 18 }

        beforeEach(() => {
          handler.mockClear()
        })

        it('on tool calls parsed by the AI SDK', async () => {
          await run({
            model: createModel({ toolName: 'greet', input: { name: 'Alice', age: 18, unknown: true } }),
            tools,
            messages: [{ role: 'user', content: 'Greet Alice' }],
          })

          expect(handler).toHaveBeenCalledOnce()
          expect(handler).toHaveBeenCalledWith(expect.objectContaining({ input: expected }), expected)
        })

        it('on approved tool calls resumed from message history', async () => {
          await run({
            model: createModel(),
            tools,
            messages: await convertToModelMessages(
              createApprovedHistory('greet', { name: 'Alice', age: 18, unknown: true }),
              { tools },
            ),
          })

          expect(handler).toHaveBeenCalledOnce()
          expect(handler).toHaveBeenCalledWith(expect.objectContaining({ input: expected }), expected)
        })
      })
    })

    it('validates input passed to execute directly', async () => {
      const handler = vi.fn(() => ({ greeting: 'Hello!' }))

      const tool = createToolFactory()(os.input(inputSchema).output(outputSchema).handler(handler))

      const streamingTool = createToolFactory()(os.input(inputSchema).handler(async function* () {
        yield handler()
      }))

      await expect(tool.execute?.({ name: 123 } as any, { abortSignal } as any)).rejects.toThrow('Input validation failed')
      await expect((streamingTool as any).execute({ name: 123 }, { abortSignal }).next()).rejects.toThrow('Input validation failed')

      expect(handler).not.toHaveBeenCalled()
    })

    it('does not trust input parsed by another tool', async () => {
      const handler = vi.fn(async ({ input }) => input)

      const createTool = createToolFactory()
      const tool1 = createTool(os.input(z.object({ name: z.string() })).handler(handler))
      const tool2 = createTool(os.input(z.object({ name: z.string().transform(name => `${name}!`) })).handler(handler))

      const parsed = await asSchema(tool1.inputSchema).validate!({ name: 'Alice' })
      expect(parsed).toEqual({ success: true, value: { name: 'Alice' } })

      await expect(tool2.execute?.((parsed as any).value, { abortSignal } as any)).resolves.toEqual({ name: 'Alice!' })
    })

    it('keeps the input schema behavior for non-object values', async () => {
      const handler = vi.fn(async ({ input }) => input)

      const tool = createToolFactory()(os.input(z.string().transform(value => `${value}!`)).handler(handler))

      await expect(asSchema(tool.inputSchema).validate!('Alice')).resolves.toEqual({ success: true, value: 'Alice!' })
      await expect(asSchema(tool.inputSchema).validate!(123)).resolves.toEqual({ success: false, error: expect.any(Error) })
    })
  })

  it('keeps output validation enabled because the AI SDK does not validate execute results', async () => {
    const procedure = os
      .input(inputSchema)
      .output(outputSchema)
      .handler(() => ({ greeting: 123 }) as any)

    const tool = createToolFactory()(procedure)

    await expect(tool.execute?.({ name: 'Alice' }, { abortSignal } as any)).rejects.toThrow('Output validation failed')
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

    it('rejects when handler ignores the declared iterator schema', async () => {
      const procedure = os
        .input(inputSchema)
        .output(asyncIteratorObject(yieldSchema))
        .handler(async () => ({ message: 'not an iterator' }) as any)

      const tool = createToolFactory()(procedure)

      const iterator = (tool as any).execute({ name: 'Alice' }, { abortSignal })
      await expect(iterator.next()).rejects.toThrow('Output validation failed')
    })

    it('validates each streamed event against the yield schema', async () => {
      const procedure = os
        .input(inputSchema)
        .output(asyncIteratorObject(yieldSchema))
        .handler(async function* () {
          yield { message: 'one' }
          yield { message: 123 } as any
        })

      const tool = createToolFactory()(procedure)

      const iterator = (tool as any).execute({ name: 'Alice' }, { abortSignal })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { message: 'one' } })
      await expect(iterator.next()).rejects.toThrow('AsyncIteratorObject validation failed')
    })

    it('streams events when the handler is an async generator without an output schema', async () => {
      const procedure = os
        .input(inputSchema)
        .handler(async function* ({ input }) {
          yield { message: `one ${input.name}` }
          yield { message: `two ${input.name}` }
          return { count: 2 }
        })

      const tool = createToolFactory()(procedure)

      expect(tool.outputSchema).toBeUndefined()

      const outputs: unknown[] = []
      for await (const output of (tool as any).execute({ name: 'Alice' }, { abortSignal })) {
        outputs.push(output)
      }

      expect(outputs).toEqual([{ message: 'one Alice' }, { message: 'two Alice' }])
    })

    it('streams events when the handler is an async generator and the output schema is not asyncIteratorObject', async () => {
      const procedure = os
        .input(inputSchema)
        .output(type<AsyncIteratorObject<{ message: string }>>())
        .handler(async function* () {
          yield { message: 'one' }
          yield { message: 'two' }
        })

      const tool = createToolFactory()(procedure)

      const outputs: unknown[] = []
      for await (const output of (tool as any).execute({ name: 'Alice' }, { abortSignal })) {
        outputs.push(output)
      }

      expect(outputs).toEqual([{ message: 'one' }, { message: 'two' }])
    })

    it('does not stream when a non-generator handler returns an async iterator without an asyncIteratorObject schema', async () => {
      const procedure = os
        .input(inputSchema)
        .handler(async () => (async function* () {
          yield { message: 'one' }
        })())

      const tool = createToolFactory()(procedure)

      const output = await (tool as any).execute({ name: 'Alice' }, { abortSignal })

      expect(output[Symbol.asyncIterator]).toBeTypeOf('function')
    })
  })
})

import type { AiSdkToolMeta } from './tool'
import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import z from 'zod'
import { AI_SDK_TOOL_META_SYMBOL, createTool, implementTool } from './tool'

describe('implementTool', () => {
  const base = oc.$meta<AiSdkToolMeta>({})

  const inputSchema = z.object({
    name: z.string().describe('Name of the person'),
  })
  const outputSchema = z.object({
    greeting: z.string().describe('Greeting message'),
  })

  it('can implement a tool', () => {
    const contract = base
      .route({
        summary: 'Greet a person',
      })
      .input(inputSchema)
      .output(outputSchema)

    const execute = vi.fn()

    const tool = implementTool(contract, {
      execute,
    })

    expect(tool.inputSchema).toBe(inputSchema)
    expect(tool.outputSchema).toBe(outputSchema)
    expect(tool.description).toBe('Greet a person')
    expect(tool.execute).toBe(execute)
  })

  it('require contract with inputSchema', () => {
    expect(() => implementTool(base.input(inputSchema), {})).not.toThrow()
    expect(() => implementTool(base, {})).toThrowError('Cannot implement tool from a contract procedure without input schema.')
  })

  it('use route.description when route.summary is not present', () => {
    const contract = base.input(inputSchema)
      .route({
        description: 'Custom description',
      })

    const tool = implementTool(contract, {})

    expect(tool.description).toBe('Custom description')
  })

  it('support meta to provide default tool options', () => {
    const contract = base
      .meta({
        [AI_SDK_TOOL_META_SYMBOL]: {
          name: 'custom-tool-name',
          description: 'Meta description',
        },
      })
      .input(inputSchema)

    const tool = implementTool(contract, {
      execute: vi.fn(),
      description: 'Override description',
    })

    expect((tool as any).name).toBe('custom-tool-name')
    expect(tool.description).toBe('Override description')
  })
})

describe('createTool', () => {
  const base = os.$meta<AiSdkToolMeta>({})

  const inputSchema = z.object({
    name: z.string().describe('Name of the person'),
  })
  const outputSchema = z.object({
    greeting: z.string().describe('Greeting message'),
  })

  it('can create a tool', () => {
    const handler = vi.fn(async ({ input }) => {
      return {
        greeting: `Hello, ${input.name}!`,
      }
    })
    const procedure
      = base
        .route({
          summary: 'Greet a person',
        })
        .input(inputSchema)
        .output(outputSchema)
        .handler(handler)

    const tool = createTool(procedure, {
      context: { authToken: 'auth-token' },
    })

    expect(tool.inputSchema).toBe(inputSchema)
    expect(tool.outputSchema).toBe(outputSchema)
    expect(tool.description).toBe('Greet a person')

    return expect(
      (tool as any).execute({ name: 'Alice' }),
    ).resolves.toEqual({ greeting: 'Hello, Alice!' })

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      input: { name: 'Alice' },
      context: { authToken: 'auth-token' },
    }))
  })
})

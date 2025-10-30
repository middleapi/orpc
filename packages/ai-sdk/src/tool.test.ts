import type { CreateAiSdkToolMeta } from './tool'
import { oc } from '@orpc/contract'
import z from 'zod'
import { CREATE_AI_SDK_TOOL_META_SYMBOL, createTool } from './tool'

describe('createTool', () => {
  const base = oc.$meta<CreateAiSdkToolMeta>({})

  const inputSchema = z.object({
    name: z.string().describe('Name of the person'),
  })
  const outputSchema = z.object({
    greeting: z.string().describe('Greeting message'),
  })

  it('can create a tool', () => {
    const contract = base
      .route({
        summary: 'Greet a person',
      })
      .input(inputSchema)
      .output(outputSchema)

    const execute = vi.fn()

    const tool = createTool(contract, {
      execute,
    })

    expect(tool.inputSchema).toBe(inputSchema)
    expect(tool.outputSchema).toBe(outputSchema)
    expect(tool.description).toBe('Greet a person')
    expect(tool.execute).toBe(execute)
  })

  it('require contract with inputSchema', () => {
    expect(() => createTool(base.input(inputSchema), {})).not.toThrow()
    expect(() => createTool(base, {})).toThrowError('Cannot create tool from a contract procedure without input schema.')
  })

  it('use route.description when route.summary is not present', () => {
    const contract = base.input(inputSchema)
      .route({
        description: 'Custom description',
      })

    const tool = createTool(contract, {})

    expect(tool.description).toBe('Custom description')
  })

  it('support meta to provide default tool options', () => {
    const contract = base
      .meta({
        [CREATE_AI_SDK_TOOL_META_SYMBOL]: {
          name: 'custom-tool-name',
          description: 'Meta description',
        },
      })
      .input(inputSchema)

    const tool = createTool(contract, {
      execute: vi.fn(),
      description: 'Override description',
    })

    expect((tool as any).name).toBe('custom-tool-name')
    expect(tool.description).toBe('Override description')
  })
})

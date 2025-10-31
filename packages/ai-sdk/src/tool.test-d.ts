import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { createTool, implementTool } from './tool'

describe('tool', () => {
  it('throw on missing inputSchema is correct, because tool require inputSchema', () => {
    tool({
      inputSchema: z.object({}),
    })

    // @ts-expect-error inputSchema is required
    tool({})
  })
})

describe('implementTool', () => {
  it('can use as a tool', () => {
    const contract = oc
      .route({
        summary: 'Get the weather in a location',
      })
      .input(z.object({
        location: z.string().describe('The location to get the weather for'),
      }))
      .output(z.object({
        location: z.string(),
        temperature: z.number().describe('The temperature in Fahrenheit'),
      }))

    const weatherTool = implementTool(contract, {
      execute: async ({ location }) => ({
        location,
        temperature: 72 + Math.floor(Math.random() * 21) - 10,
      }),
    })

    void generateText({
      model: 'openai/gpt-4o',
      tools: {
        weather: weatherTool,
      },
      prompt: 'What is the weather in San Francisco?',
    })
  })

  it('infer correct input & output', () => {
    const contract = oc
      .route({
        summary: 'Get the weather in a location',
      })
      .input(z.object({
        stringToNumber: z.string().transform(val => Number(val)),
      }))
      .output(z.object({
        numberToBoolean: z.number().transform(val => Boolean(val)),
      }))

    const tool = implementTool(contract, {
      execute: async ({ stringToNumber }) => {
        expectTypeOf(stringToNumber).toEqualTypeOf<number>()

        return {
          numberToBoolean: stringToNumber,
        }
      },
    })

    const tool2 = implementTool(contract, {
      // @ts-expect-error invalid numberToBoolean
      execute: async ({ stringToNumber }) => {
        return {
          numberToBoolean: true,
        }
      },
    })
  })
})

describe('createTool', () => {
  it('can use as a tool', () => {
    const procedure = os
      .route({
        summary: 'Get the weather in a location',
      })
      .input(z.object({
        location: z.string().describe('The location to get the weather for'),
      }))
      .output(z.object({
        location: z.string(),
        temperature: z.number().describe('The temperature in Fahrenheit'),
      }))
      .handler(async ({ input }) => {
        return {
          location: input.location,
          temperature: 72 + Math.floor(Math.random() * 21) - 10,
        }
      })

    const weatherTool = createTool(procedure)

    void generateText({
      model: 'openai/gpt-4o',
      tools: {
        weather: weatherTool,
      },
      prompt: 'What is the weather in San Francisco?',
    })
  })

  it('infer correct input & output', () => {
    const procedure = os
      .route({
        summary: 'Get the weather in a location',
      })
      .input(z.object({
        stringToNumber: z.string().transform(val => Number(val)),
      }))
      .output(z.object({
        numberToBoolean: z.number().transform(val => Boolean(val)),
      }))
      .handler(async ({ input }) => {
        return {
          numberToBoolean: input.stringToNumber,
        }
      })

    const tool = createTool(procedure, {
      execute: async ({ stringToNumber }) => {
        expectTypeOf(stringToNumber).toEqualTypeOf<number>()

        return {
          numberToBoolean: stringToNumber,
        }
      },
    })

    const tool2 = createTool(procedure, {
      // @ts-expect-error invalid numberToBoolean
      execute: async ({ stringToNumber }) => {
        return {
          numberToBoolean: true,
        }
      },
    })
  })

  it('require provide initial context if required', () => {
    const procedure = os
      .$context<{ authToken: string }>()
      .input(z.object({
        location: z.string().describe('The location to get the weather for'),
      }))
      .handler(async ({ context, input }) => {})

    void createTool(procedure, {
      context: { authToken: '' },
    })

    // @ts-expect-error missing context
    void createTool(procedure, {})
  })
})

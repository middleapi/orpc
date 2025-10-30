import { oc } from '@orpc/contract'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { createTool } from './tool'

describe('createTool', () => {
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

    const weatherTool = createTool(contract, {
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

    const tool = createTool(contract, {
      execute: async ({ stringToNumber }) => {
        expectTypeOf(stringToNumber).toEqualTypeOf<number>()

        return {
          numberToBoolean: stringToNumber,
        }
      },
    })

    const tool2 = createTool(contract, {
      // @ts-expect-error invalid numberToBoolean
      execute: async ({ stringToNumber }) => {
        return {
          numberToBoolean: true,
        }
      },
    })
  })

  it('throw on missing inputSchema is correct, because tool require inputSchema', () => {
    tool({
      inputSchema: z.object({}),
    })

    // @ts-expect-error inputSchema is required
    tool({})
  })
})

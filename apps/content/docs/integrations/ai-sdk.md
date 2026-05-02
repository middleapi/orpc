---
title: AI SDK Integration
description: Seamlessly use AI SDK inside your oRPC projects without any extra overhead.
---

# AI SDK Integration

[AI SDK](https://ai-sdk.dev/) is a free open-source library for building AI-powered products. You can seamlessly integrate it with oRPC without any extra overhead.

::: warning
This documentation requires AI SDK v5.0.0 or later. For a refresher, review the [AI SDK documentation](https://ai-sdk.dev/docs).
:::

## Server

Use `streamToEventIterator` to convert AI SDK streams to [oRPC Event Iterators](/docs/event-iterator).

```ts twoslash
import { os, streamToEventIterator, type } from '@orpc/server'
import { convertToModelMessages, streamText, UIMessage } from 'ai'
import { google } from '@ai-sdk/google'

export const chat = os
  .input(type<{ chatId: string, messages: UIMessage[] }>())
  .handler(async ({ input }) => {
    const result = streamText({
      model: google('gemini-1.5-flash'),
      system: 'You are a helpful assistant.',
      messages: await convertToModelMessages(input.messages),
    })

    return streamToEventIterator(result.toUIMessageStream())
  })
```

## Client

On the client side, convert the event iterator back to a stream using `eventIteratorToStream` or `eventIteratorToUnproxiedDataStream`.

```tsx twoslash
import React, { useState } from 'react'
import { os, streamToEventIterator, type } from '@orpc/server'
import { convertToModelMessages, streamText, UIMessage } from 'ai'
import { google } from '@ai-sdk/google'

export const chat = os
  .input(type<{ chatId: string, messages: UIMessage[] }>())
  .handler(async ({ input }) => {
    const result = streamText({
      model: google('gemini-1.5-flash'),
      system: 'You are a helpful assistant.',
      messages: await convertToModelMessages(input.messages),
    })

    return streamToEventIterator(result.toUIMessageStream())
  })
  .callable()

const client = { chat }
// ---cut---
import { useChat } from '@ai-sdk/react'
import { eventIteratorToUnproxiedDataStream } from '@orpc/client'

export function Example() {
  const { messages, sendMessage, status } = useChat({
    transport: {
      async sendMessages(options) {
        return eventIteratorToUnproxiedDataStream(await client.chat({
          chatId: options.chatId,
          messages: options.messages,
        }, { signal: options.abortSignal }))
      },
      reconnectToStream(options) {
        throw new Error('Unsupported')
      },
    },
  })
  const [input, setInput] = useState('')

  return (
    <>
      {messages.map(message => (
        <div key={message.id}>
          {message.role === 'user' ? 'User: ' : 'AI: '}
          {message.parts.map((part, index) =>
            part.type === 'text' ? <span key={index}>{part.text}</span> : null,
          )}
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (input.trim()) {
            sendMessage({ text: input })
            setInput('')
          }
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={status !== 'ready'}
          placeholder="Say something..."
        />
        <button type="submit" disabled={status !== 'ready'}>
          Submit
        </button>
      </form>
    </>
  )
}
```

::: info
The `reconnectToStream` function is not supported by default, which is fine for most use cases. If you need reconnection support, implement it similar to `sendMessages` with custom reconnection logic. See this [reconnect example](<https://github.com/vercel/ai-chatbot/blob/main/app/(chat)/api/chat/%5Bid%5D/stream/route.ts>).
:::

::: info
Prefer `eventIteratorToUnproxiedDataStream` over `eventIteratorToStream`.
AI SDK internally uses `structuredClone`, which doesn't support proxied data.
oRPC may proxy events for [metadata](/docs/event-iterator#last-event-id-event-metadata), so unproxy before passing to AI SDK.
:::

## `implementTool` helper

Implements [procedure contract](/docs/contract-first/define-contract) as an [AI SDK tools](https://ai-sdk.dev/docs/foundations/tools) by leveraging existing contract definitions.

```ts twoslash
import { oc } from '@orpc/contract'
import {
  AI_SDK_TOOL_META_SYMBOL,
  AiSdkToolMeta,
  implementTool
} from '@orpc/ai-sdk'
import { z } from 'zod'

interface ORPCMeta extends AiSdkToolMeta {} // optional extend meta
const base = oc.$meta<ORPCMeta>({})

const getWeatherContract = base
  .meta({
    [AI_SDK_TOOL_META_SYMBOL]: {
      title: 'Get Weather', // AI SDK tool title
    },
  })
  .route({
    summary: 'Get the weather in a location', // AI SDK tool description
  })
  .input(z.object({
    location: z.string().describe('The location to get the weather for'),
  }))
  .output(z.object({
    location: z.string().describe('The location the weather is for'),
    temperature: z.number().describe('The temperature in Celsius'),
  }))

const getWeatherTool = implementTool(getWeatherContract, {
  execute: async ({ location }) => ({
    location,
    temperature: 72 + Math.floor(Math.random() * 21) - 10,
  }),
  // ...add any additional configuration or overrides here
})
```

::: warning
The `implementTool` helper requires a contract with an `input` schema defined
:::

::: info
Standard [procedures](/docs/procedure) are also compatible with [procedure contracts](/docs/contract-first/define-contract).
:::

## `createTool` helper

Converts a [procedure](/docs/procedure) into an [AI SDK Tool](https://ai-sdk.dev/docs/foundations/tools) by leveraging existing procedure definitions.

```ts twoslash
import { os } from '@orpc/server'
import {
  AI_SDK_TOOL_META_SYMBOL,
  AiSdkToolMeta,
  createTool
} from '@orpc/ai-sdk'
import { z } from 'zod'

interface ORPCMeta extends AiSdkToolMeta {} // optional extend meta
const base = os.$meta<ORPCMeta>({})

const getWeatherProcedure = base
  .meta({
    [AI_SDK_TOOL_META_SYMBOL]: {
      title: 'Get Weather', // AI SDK tool title
    },
  })
  .route({
    summary: 'Get the weather in a location',
  })
  .input(z.object({
    location: z.string().describe('The location to get the weather for'),
  }))
  .output(z.object({
    location: z.string().describe('The location the weather is for'),
    temperature: z.number().describe('The temperature in Celsius'),
  }))
  .handler(async ({ input }) => ({
    location: input.location,
    temperature: 72 + Math.floor(Math.random() * 21) - 10,
  }))

const getWeatherTool = createTool(getWeatherProcedure, {
  context: {}, // provide initial context if needed
  // ...add any additional configuration or overrides here
})
```

::: warning
The `createTool` helper requires a procedure with an `input` schema defined
:::

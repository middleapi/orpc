# AI SDK Integration

[AI SDK](https://ai-sdk.dev/) is a free open-source library for building AI-powered products. You can seamlessly integrate it with oRPC without any extra overhead.

::: warning
This documentation requires AI SDK v5.0.0 or later. For a refresher, review the [AI SDK documentation](https://ai-sdk.dev/docs).
:::

## Server

Use `streamToAsyncIteratorObject` to convert AI SDK streams to [oRPC AsyncIteratorObjects](/docs/async-iterator-object).

```ts
import { os, streamToAsyncIteratorObject, type } from '@orpc/server'
import { convertToModelMessages, streamText, UIMessage } from 'ai'
import { google } from '@ai-sdk/google'

export const chat = os
  .input(type<{ chatId: string, messages: UIMessage[] }>())
  .handler(async ({ input }) => {
    const result = streamText({
      model: google('gemini-2.5-flash'),
      system: 'You are a helpful assistant.',
      messages: await convertToModelMessages(input.messages),
    })

    return streamToAsyncIteratorObject(result.toUIMessageStream())
  })
```

## Client

On the client side, convert the async iterator back to a stream using `asyncIteratorToUnproxiedDataStream`.

```tsx
import { useChat } from '@ai-sdk/react'
import { asyncIteratorToUnproxiedDataStream } from '@orpc/client'
import { useState } from 'react'

export function Example() {
  const { messages, sendMessage, status } = useChat({
    transport: {
      async sendMessages(options) {
        return asyncIteratorToUnproxiedDataStream(await client.chat({
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
Prefer `asyncIteratorToUnproxiedDataStream` over `asyncIteratorToStream`.
AI SDK internally uses `structuredClone`, which doesn't support proxied data.
oRPC may proxy events for [metadata](/docs/async-iterator-object#last-event-id-event-metadata), so unproxy before passing to AI SDK.
:::

## Tool Calling

Expose a [procedure](/docs/procedure) as an [AI SDK tool](https://ai-sdk.dev/docs/foundations/tools) by combining `tool` from AI SDK with a [server-side call](/docs/client/server-side):

```ts
import * as z from 'zod'
import { call, os } from '@orpc/server'
import { tool } from 'ai'

const getWeatherProcedure = os
  .input(z.object({
    location: z.string().describe('The location to get the weather for'),
  }))
  .handler(async ({ input }) => ({
    location: input.location,
    temperature: 72 + Math.floor(Math.random() * 21) - 10,
  }))

const getWeatherTool = tool({
  description: 'Get the weather in a location',
  inputSchema: z.object({
    location: z.string().describe('The location to get the weather for'),
  }),
  execute: input => call(getWeatherProcedure, input, {
    context: {}, // provide initial context if needed
  }),
})
```

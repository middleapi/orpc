---
title: OpenAI Streaming Example
description: Combine oRPC with the OpenAI Streaming API to build a chatbot
---

# OpenAI Streaming Example

This example shows how to integrate oRPC with the OpenAI Streaming API to build a chatbot.

## Basic Example

```ts twoslash
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { os, RouterClient } from '@orpc/server'
import { z } from 'zod'
// ---cut---
import OpenAI from 'openai'

const openai = new OpenAI()

const complete = os
  .input(z.object({ content: z.string() }))
  .handler(async function* ({ input }) {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: input.content }],
      stream: true,
    })

    yield* stream
  })

const router = { complete }

const link = new RPCLink({
  url: 'https://example.com/rpc',
})

const client: RouterClient<typeof router> = createORPCClient(link)

const stream = await client.complete({ content: 'Hello, world!' })

for await (const chunk of stream) {
  console.log(chunk.choices[0]?.delta?.content || '')
}
```

Learn more about [RPCLink](/docs/client/rpc-link) and [Event Iterator](/docs/client/event-iterator).

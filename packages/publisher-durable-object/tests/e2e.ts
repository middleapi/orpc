import type { DurableObjectNamespace, DurableObjectState, ExportedHandler } from '@cloudflare/workers-types/experimental'
import type { Publisher } from '@orpc/experimental-publisher'
import { onError, os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { z } from 'zod'
import { DurablePublisher, PublisherDurableObject } from '../src'

interface Env {
  PUBLISHER_DO: DurableObjectNamespace
}

const base = os.$context<{
  publisher: Publisher<Record<string, { message: string }>>
}>()

export const router = {
  publish: base
    .input(z.object({ room: z.string(), message: z.string() }))
    .handler(async ({ context, input }) => {
      await context.publisher.publish(input.room, { message: input.message })
    }),
  subscribe: base
    .input(z.object({ room: z.string() }))
    .handler(async ({ context, input, lastEventId, signal }) => {
      return context.publisher.subscribe(input.room, { lastEventId, signal })
    }),
}

export class PublisherDO extends PublisherDurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      resume: {
        retentionSeconds: 1,
      },
    })
  }
}
const handler = new RPCHandler(router, {
  interceptors: [
    onError(error => console.error(error)),
  ],
})

export default {
  async fetch(request, env) {
    const publisher = new DurablePublisher<any>(env.PUBLISHER_DO)

    const { response } = await handler.handle(request as any, {
      context: {
        publisher,
      },
    })

    return (response ?? new Response('Not Found', { status: 404 })) as any
  },
} satisfies ExportedHandler<Env>

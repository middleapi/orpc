import '../../polyfill'
import type { APIRoute } from 'astro'
import { onError } from '@orpc/server'
import { BatchHandlerPlugin } from '@orpc/server/plugins'
import { RPCHandler } from '@orpc/server/fetch'
import { router } from '../../routers'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
  plugins: [
    new BatchHandlerPlugin(),
  ],
})

export const prerender = false

export const ALL: APIRoute = async ({ request }) => {
  const { response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {
      session: { user: { id: 'unique', name: 'Example', email: 'example@example.com' } },
    },
  })

  return response ?? new Response('Not found', { status: 404 })
}

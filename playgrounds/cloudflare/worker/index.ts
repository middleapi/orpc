import {
  experimental_CloudflareTracer as CloudflareTracer,
  DurablePublisher,
  DurablePublisherObject,
} from '@orpc/cloudflare'
import { EvlogHandlerPlugin } from '@orpc/evlog'
import { SmartCoercionHandlerPlugin } from '@orpc/json-schema'
import { OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { OpenAPIReferenceHandlerPlugin } from '@orpc/openapi/plugins'
import { RPCHandler } from '@orpc/server/fetch'
import { CORSHandlerPlugin } from '@orpc/server/plugins'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

import { router } from './routers'

new CloudflareTracer().enable()

const zodConverter = new ZodToJsonSchemaConverter()

const openapiGenerator = new OpenAPIGenerator({
  converters: [zodConverter],
})

const openapiHandler = new OpenAPIHandler(router, {
  plugins: [
    new CORSHandlerPlugin({
      exposeHeaders: ['Content-Disposition', 'Standard-Server'],
    }),
    new EvlogHandlerPlugin({ logAbort: true }),
    new SmartCoercionHandlerPlugin({ converters: [zodConverter] }),
    new OpenAPIReferenceHandlerPlugin({
      spec: () =>
        openapiGenerator.generate(router, {
          base: {
            servers: [{ url: '/api' }],
            components: {
              securitySchemes: {
                bearerAuth: {
                  type: 'http',
                  scheme: 'bearer',
                },
              },
            },
          },
        }),
      providerConfig: {
        authentication: {
          securitySchemes: {
            bearerAuth: {
              token: 'default-token',
            },
          },
        },
      },
    }),
  ],
})

const rpcHandler = new RPCHandler(router, {
  plugins: [new EvlogHandlerPlugin({ logAbort: true })],
})

export default {
  async fetch(request, env, _ctx) {
    if (
      new URL(request.url).pathname === '/chat-room' &&
      request.headers.get('upgrade') === 'websocket'
    ) {
      const id = env.CHAT_ROOM_DON.idFromName('default')
      return env.CHAT_ROOM_DON.get(id).fetch(request)
    }

    const messagePublisher = new DurablePublisher<Record<string, { message: string }>>(
      env.PUBLISHER_DON,
    )

    const openapiResult = await openapiHandler.handle(request, {
      prefix: '/api',
      context: { messagePublisher },
    })
    if (openapiResult.matched) {
      return openapiResult.response
    }

    const rpcResult = await rpcHandler.handle(request, {
      prefix: '/rpc',
      context: { messagePublisher },
    })
    if (rpcResult.matched) {
      return rpcResult.response
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>

export { ChatRoomDO } from './dos/chat-room'

export class PublisherDO extends DurablePublisherObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      resume: true,
    })
  }
}

import type { ServerContext } from './orpc'
import { createServer } from 'node:http'
import process from 'node:process'
import { EffectSchemaToJsonSchemaConverter } from '@orpc/experimental-effect'
import { SmartCoercionHandlerPlugin } from '@orpc/json-schema'
import { OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { OpenAPIReferenceHandlerPlugin } from '@orpc/openapi/plugins'
import { RPCHandler } from '@orpc/server/node'
import { router } from './routers'
import { runtime } from './runtime'

const effectConverter = new EffectSchemaToJsonSchemaConverter()

const openapiGenerator = new OpenAPIGenerator({
  converters: [effectConverter],
})

const rpcHandler = new RPCHandler(router)

const openapiHandler = new OpenAPIHandler(router, {
  plugins: [
    new SmartCoercionHandlerPlugin({ converters: [effectConverter] }),
    new OpenAPIReferenceHandlerPlugin({
      spec: () => openapiGenerator.generate(router, {
        base: {
          info: { title: 'oRPC Effect Playground', version: '1.0.0' },
          servers: [{ url: '/api' }],
        },
      }),
    }),
  ],
})

/**
 * The services are built once by the managed runtime, and every request
 * receives them through `effect/context`.
 */
const context: ServerContext = {
  'effect/context': await runtime.context(),
}

const server = createServer(async (req, res) => {
  const rpcResult = await rpcHandler.handle(req, res, { prefix: '/rpc', context })

  if (rpcResult.matched) {
    return
  }

  const apiResult = await openapiHandler.handle(req, res, { prefix: '/api', context })

  if (apiResult.matched) {
    return
  }

  res.statusCode = 404
  res.end('Not found')
})

server.listen(3000, () => {
  console.log('RPC endpoint at http://localhost:3000/rpc')
  console.log('OpenAPI reference at http://localhost:3000/api')
})

async function shutdown() {
  server.close()
  await runtime.dispose()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

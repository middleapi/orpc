import { router } from '@/routers'
import { messagePublisher } from '@/context'
import { MCPHandler } from '@orpc/experimental-mcp/fetch'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

const handler = new MCPHandler(router, {
  serverInfo: { name: 'orpc-playground', version: '1.0.0' },
  converters: [new ZodToJsonSchemaConverter()],
})

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    context: { messagePublisher },
  })

  return response ?? new Response('Not found', { status: 404 })
}

export const GET = handleRequest
export const POST = handleRequest
export const DELETE = handleRequest

import { OpenAPIHandler } from '@orpc/openapi/node'
import { onError } from '@orpc/server'
import { ZodSmartCoercionPlugin } from '@orpc/zod'
import { router } from '~/server/router'

const openAPIHandler = new OpenAPIHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
  plugins: [
    new ZodSmartCoercionPlugin(),
  ],
})

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, 'authorization')
  const context = authorization
    ? { user: { id: 'test', name: 'John Doe', email: 'john@doe.com' } }
    : {}

  const { matched } = await openAPIHandler.handle(event.node.req, event.node.res, {
    prefix: '/api',
    context,
  })

  if (matched) {
    return
  }

  setResponseStatus(event, 404, 'Not Found')
  return 'Not Found'
})

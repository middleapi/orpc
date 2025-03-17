import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/node'
import { router } from '~/server/router'

const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, 'authorization')
  const context = authorization
    ? { user: { id: 'test', name: 'John Doe', email: 'john@doe.com' } }
    : {}

  const { matched } = await rpcHandler.handle(event.node.req, event.node.res, {
    prefix: '/rpc',
    context,
  })

  if (matched) {
    return
  }

  setResponseStatus(event, 404, 'Not Found')
  return 'Not Found'
})

import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { BatchHandlerPlugin } from '@orpc/server/plugins'
import { router } from '../../routers'

const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
  plugins: [
    new BatchHandlerPlugin(),
  ],
})

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event)

  const context = { user: { id: 'test', name: 'John Doe', email: 'john@doe.com' } }

  const { response } = await rpcHandler.handle(request, {
    prefix: '/rpc',
    context,
  })

  if (response) {
    return response
  }

  setResponseStatus(event, 404, 'Not Found')
  return 'Not Found'
})

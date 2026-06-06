import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { getUserFromRequest } from '../../auth-context'
import { router } from '../../routers'

const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    })
  ]
})

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event)
  const user = await getUserFromRequest(request.headers)

  const { response } = await rpcHandler.handle(request, {
    prefix: '/rpc',
    context: {
      headers: request.headers,
      ...(user ? { user } : {})
    }
  })

  if (response) {
    return response
  }

  setResponseStatus(event, 404, 'Not Found')
  return 'Not Found'
})

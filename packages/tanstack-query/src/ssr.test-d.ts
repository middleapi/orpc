import type { Client } from '@orpc/client'
import { RPCSerializer } from '@orpc/client'
import { createRouterUtils } from './router-utils.ts'
import { createHydrationOptions, StreamQuerySSRUtilsPlugin } from './ssr.ts'

it('accepts an RPCSerializer', () => {
  createHydrationOptions(new RPCSerializer())

  // @ts-expect-error not a serializer
  createHydrationOptions({})
})

it('StreamQuerySSRUtilsPlugin infers the client', () => {
  const client = {} as { ping: Client<{ cache?: boolean }, string, string, Error> }

  createRouterUtils(client, { plugins: [new StreamQuerySSRUtilsPlugin()] })
})

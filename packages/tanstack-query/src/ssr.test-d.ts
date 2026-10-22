import type { Client } from '@orpc/client'
import { RPCSerializer } from '@orpc/client'
import { createQueryKeyHashFn } from './key'
import { createRouterUtils } from './router-utils'
import { createHydrationOptions, StreamQuerySSRUtilsPlugin } from './ssr'

it('accepts an RPCSerializer', () => {
  createQueryKeyHashFn(new RPCSerializer())
  createHydrationOptions(new RPCSerializer())

  // @ts-expect-error not a serializer
  createQueryKeyHashFn({})
  // @ts-expect-error not a serializer
  createHydrationOptions({})
})

it('StreamQuerySSRUtilsPlugin infers the client', () => {
  const client = {} as { ping: Client<{ cache?: boolean }, string, string, Error> }

  createRouterUtils(client, { plugins: [new StreamQuerySSRUtilsPlugin()] })
})

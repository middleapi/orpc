import type { Client } from '@orpc/client'
import { RPCSerializer } from '@orpc/client'

import { createRouterUtils } from './router-utils'
import { createHydrationOptions, StreamQuerySSRUtilsPlugin } from './ssr'

it('accepts an RPCSerializer', () => {
  createHydrationOptions()
  createHydrationOptions({})
  createHydrationOptions({ serializer: new RPCSerializer() })

  // @ts-expect-error not a serializer
  createHydrationOptions({ serializer: {} })
  // @ts-expect-error the serializer is no longer a positional argument
  createHydrationOptions(new RPCSerializer())
})

it('StreamQuerySSRUtilsPlugin infers the client', () => {
  const client = {} as { ping: Client<{ cache?: boolean }, string, string, Error> }

  createRouterUtils(client, { plugins: [new StreamQuerySSRUtilsPlugin()] })
})

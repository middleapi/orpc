import type { StandardLinkPlugin } from '@orpc/client/standard'
import type { JsonifiedClient, OpenAPIJsonSerializer } from '@orpc/openapi'
import type { AnyRouter, Context, RouterClient } from '@orpc/server'
import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { Public } from '@orpc/shared'

export interface OpenRPCClientServerTestOptions {
  context?: Context
  serializer?: Public<OpenAPIJsonSerializer>
  handlerPlugins?: StandardHandlerPlugin<any>[]
  linkPlugins?: StandardLinkPlugin<any>[]
}

export interface CreateOpenRPCClientServerTest {
  <T extends AnyRouter>(router: T, options?: OpenRPCClientServerTestOptions): JsonifiedClient<RouterClient<T>>
}

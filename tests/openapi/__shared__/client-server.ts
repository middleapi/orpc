import type { AnyRouter, Context, RouterClient } from '@orpc/server'
import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { Public } from '@orpc/shared'
import { OpenAPISerializer } from '@orpc/openapi'

export interface OpenAPIClientServerTestOptions {
  context?: Context
  serializer?: Public<OpenAPISerializer>
  plugins?: StandardHandlerPlugin<Context>[]
}

export interface CreateOpenAPIClientServerTest {
  <T extends AnyRouter>(router: T, options?: OpenAPIClientServerTestOptions): RouterClient<T>
}

export const defaultSerializer = new OpenAPISerializer()

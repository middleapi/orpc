import type { AnyRouter, Context, RouterClient } from '@orpc/server'
import { OpenAPISerializer } from '@orpc/openapi'

export interface OpenAPIClientServerTestOptions {
  context?: Context
  serializer?: Pick<OpenAPISerializer, keyof OpenAPISerializer>
}

export interface CreateOpenAPIClientServerTest {
  <T extends AnyRouter>(router: T, options?: OpenAPIClientServerTestOptions): RouterClient<T>
}

export const defaultSerializer = new OpenAPISerializer()

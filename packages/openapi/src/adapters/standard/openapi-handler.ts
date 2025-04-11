import type { StandardOpenAPIJsonSerializerOptions } from '@orpc/openapi-client/standard'
import type { Context, Router } from '@orpc/server'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import { StandardBracketNotationSerializer, StandardOpenAPIJsonSerializer, StandardOpenAPISerializer } from '@orpc/openapi-client/standard'
import { StandardHandler } from '@orpc/server/standard'
import { StandardOpenAPICodec } from './openapi-codec'
import { StandardOpenAPIMatcher } from './openapi-matcher'

export interface StandardOpenAPIHandlerOptions<T extends Context>
  extends StandardHandlerOptions<T>, StandardOpenAPIJsonSerializerOptions {}

export class StandardOpenAPIHandler<T extends Context> extends StandardHandler<T> {
  constructor(router: Router<any, T>, options: NoInfer<StandardOpenAPIHandlerOptions<T>>) {
    const jsonSerializer = new StandardOpenAPIJsonSerializer(options)
    const bracketNotationSerializer = new StandardBracketNotationSerializer()
    const serializer = new StandardOpenAPISerializer(jsonSerializer, bracketNotationSerializer)
    const matcher = new StandardOpenAPIMatcher()
    const codec = new StandardOpenAPICodec(serializer)

    super(router, matcher, codec, options)
  }
}

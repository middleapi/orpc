import type { StandardRPCJsonSerializerOptions } from '@orpc/client/standard'
import type { Context } from '../../context'
import type { Router } from '../../router'
import type { StandardHandlerOptions } from './handler'
import { StandardRPCJsonSerializer, StandardRPCSerializer } from '@orpc/client/standard'
import { StrictGetMethodPlugin } from '../../plugins'
import { StandardHandler } from './handler'
import { StandardRPCCodec } from './rpc-codec'
import { StandardRPCMatcher } from './rpc-matcher'

export interface StandardRPCHandlerOptions<T extends Context> extends StandardHandlerOptions<T>, StandardRPCJsonSerializerOptions {
  /**
   * Enables or disables the StrictGetMethodPlugin.
   *
   * @default true
   */
  strictGetMethodPluginEnabled?: boolean
}

export class StandardRPCHandler<T extends Context> extends StandardHandler<T> {
  constructor(router: Router<any, T>, options: StandardRPCHandlerOptions<T>) {
    options.plugins ??= []

    const strictGetMethodPluginEnabled = options.strictGetMethodPluginEnabled ?? true

    if (strictGetMethodPluginEnabled) {
      options.plugins.push(new StrictGetMethodPlugin())
    }

    const jsonSerializer = new StandardRPCJsonSerializer(options)
    const serializer = new StandardRPCSerializer(jsonSerializer)
    const matcher = new StandardRPCMatcher()
    const codec = new StandardRPCCodec(serializer)

    super(router, matcher, codec, options)
  }
}

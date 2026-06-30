import type { DynamicModule } from '@nestjs/common'
import type { AnySchema } from '@orpc/contract'
import type { StandardBracketNotationSerializerOptions, StandardOpenAPIJsonSerializerOptions } from '@orpc/openapi-client/standard'
import type { StandardOpenAPICodecOptions } from '@orpc/openapi/standard'
import type { CreateProcedureClientOptions } from '@orpc/server'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { Interceptor } from '@orpc/shared'
import type { StandardResponse } from '@orpc/standard-server'
import type { SendStandardResponseOptions } from '@orpc/standard-server-node'
import { Module } from '@nestjs/common'
import { ImplementInterceptor } from './implement'

export const ORPC_MODULE_CONFIG_SYMBOL = Symbol('ORPC_MODULE_CONFIG')

/**
 * You can extend this interface to add global context properties.
 * @example
 * ```ts
 * declare module '@orpc/nest' {
 *   interface ORPCGlobalContext {
 *     user: { id: string; name: string }
 *   }
 * }
 * ```
 */
export interface ORPCGlobalContext {

}
// TODO: replace CreateProcedureClientOptions with StandardHandlerOptions
export interface ORPCModuleConfig extends
  CreateProcedureClientOptions<ORPCGlobalContext, AnySchema, object, object, object>,
  SendStandardResponseOptions,
  StandardOpenAPIJsonSerializerOptions,
  StandardBracketNotationSerializerOptions,
  StandardOpenAPICodecOptions {
  plugins?: StandardHandlerOptions<ORPCGlobalContext>['plugins']

  sendResponseInterceptors?: Interceptor<
    { request: any, response: any, standardResponse: StandardResponse },
    unknown
  >[]
}

@Module({})
export class ORPCModule {
  static forRoot(config: ORPCModuleConfig): DynamicModule {
    return {
      module: ORPCModule,
      providers: [
        {
          provide: ORPC_MODULE_CONFIG_SYMBOL,
          useValue: config,
        },
        ImplementInterceptor,
      ],
      exports: [ORPC_MODULE_CONFIG_SYMBOL, ImplementInterceptor],
      global: true,
    }
  }

  static forRootAsync(options: {
    imports?: any[]
    useFactory: (...args: any[]) => Promise<ORPCModuleConfig> | ORPCModuleConfig
    inject?: any[]
  }): DynamicModule {
    return {
      module: ORPCModule,
      imports: options.imports,
      providers: [
        {
          provide: ORPC_MODULE_CONFIG_SYMBOL,
          useFactory: options.useFactory,
          inject: options.inject,
        },
        ImplementInterceptor,
      ],
      exports: [ORPC_MODULE_CONFIG_SYMBOL, ImplementInterceptor],
      global: true,
    }
  }
}

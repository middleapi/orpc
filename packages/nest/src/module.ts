import type { DynamicModule } from '@nestjs/common'
import type { OpenAPIHandlerCodecCoreOptions } from '@orpc/openapi/standard'
import type { DefaultInitialContext } from '@orpc/server'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { StandardLazyRequest } from '@standardserver/core'
import type { ToEventStreamOptions } from '@standardserver/node'
import { Module } from '@nestjs/common'
import { ImplementInterceptor } from './implement'

export const ORPC_MODULE_CONFIG_SYMBOL = Symbol.for('ORPC_NEST_MODULE_CONFIG')

export type ORPCModuleConfig
  = & OpenAPIHandlerCodecCoreOptions<DefaultInitialContext>
    & StandardHandlerOptions<DefaultInitialContext>
    & (object extends DefaultInitialContext ? { context?: DefaultInitialContext } : { context: DefaultInitialContext })
    & {
      /**
       * Customize how convert next.js req and res to StandardLazyRequest,
       * You might need define this if you not using express or fastify adapters
       */
      toStandardLazyRequest?: undefined | ((req: any, res: any) => StandardLazyRequest)

      /**
       * Options for how to convert the Standard Response to a Nest Response (returning value), like event iterator options, etc.
       */
      toNestResponse?: undefined | {
        /**
         * Options for the event stream, like keep-alive settings, initial comment, etc.
         */
        eventStream?: undefined | ToEventStreamOptions
      }
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

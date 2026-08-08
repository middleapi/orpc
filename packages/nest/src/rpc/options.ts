import type { ExecutionContext } from '@nestjs/common'
import type { DefaultInitialContext } from '@orpc/server'
import type { RPCHandlerCodecCoreOptions, StandardHandlerOptions } from '@orpc/server/standard'
import type { Promisable, Value } from '@orpc/shared'
import type { NestStandardLazyRequest, ToNestResponseConfig } from '../common/types'
import { ConfigurableModuleBuilder } from '@nestjs/common'

export type ORPCModuleOptions
  = & RPCHandlerCodecCoreOptions<DefaultInitialContext>
    & StandardHandlerOptions<DefaultInitialContext>
    & (object extends DefaultInitialContext
      ? { context?: Value<Promisable<DefaultInitialContext>, [ctx: ExecutionContext]> }
      : { context: Value<Promisable<DefaultInitialContext>, [ctx: ExecutionContext]> })
    & {
      toNestStandardLazyRequest?: undefined | ((req: any, res: any) => NestStandardLazyRequest)
      toNestResponse?: undefined | ToNestResponseConfig
    }

export const {
  ConfigurableModuleClass: ORPCConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN: ORPC_MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE: ORPC_OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE: ORPC_ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<ORPCModuleOptions>()
  .setClassMethodName('forRoot')
  .build()

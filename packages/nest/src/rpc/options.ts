import type { DefaultInitialContext } from '@orpc/server'
import type { RPCHandlerCodecCoreOptions } from '@orpc/server/standard'
import type { BaseORPCModuleOptions } from '../common/options'
import { ConfigurableModuleBuilder } from '@nestjs/common'

export type ORPCModuleOptions
  = & BaseORPCModuleOptions
    & RPCHandlerCodecCoreOptions<DefaultInitialContext>

export const {
  ConfigurableModuleClass: ORPCConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN: ORPC_MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE: ORPC_OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE: ORPC_ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<ORPCModuleOptions>()
  .setClassMethodName('forRoot')
  .build()

import type { OpenAPIHandlerCodecCoreOptions } from '@orpc/openapi/standard'
import type { DefaultInitialContext } from '@orpc/server'
import type { BaseORPCModuleOptions } from '../common/options'
import { ConfigurableModuleBuilder } from '@nestjs/common'

export type ORPCModuleOptions
  = & BaseORPCModuleOptions
    & OpenAPIHandlerCodecCoreOptions<DefaultInitialContext>

export const {
  ConfigurableModuleClass: ORPCConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN: ORPC_MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE: ORPC_OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE: ORPC_ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<ORPCModuleOptions>()
  .setClassMethodName('forRoot')
  .build()

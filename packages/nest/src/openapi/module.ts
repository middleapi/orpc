import { Module } from '@nestjs/common'
import { ImplementInterceptor } from './implement'
import { ORPC_MODULE_OPTIONS_TOKEN, ORPCConfigurableModuleClass } from './options'

@Module({
  providers: [ImplementInterceptor],
  exports: [ORPC_MODULE_OPTIONS_TOKEN, ImplementInterceptor],
})
export class ORPCModule extends ORPCConfigurableModuleClass {}

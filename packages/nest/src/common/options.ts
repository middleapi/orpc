import type { ExecutionContext } from '@nestjs/common'
import type { DefaultInitialContext } from '@orpc/server'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { Promisable, Value } from '@orpc/shared'
import type { NestStandardLazyRequest, ToNestResponseConfig } from './types'

export type BaseORPCModuleOptions
  = & StandardHandlerOptions<DefaultInitialContext>
    & (object extends DefaultInitialContext
      ? { context?: Value<Promisable<DefaultInitialContext>, [ctx: ExecutionContext]> }
      : { context: Value<Promisable<DefaultInitialContext>, [ctx: ExecutionContext]> })
    & {
      toNestStandardLazyRequest?: undefined | ((req: any, res: any) => NestStandardLazyRequest)
      toNestResponse?: undefined | ToNestResponseConfig
    }

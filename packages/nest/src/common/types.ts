import type { StandardLazyRequest } from '@standardserver/core'
import type { ToEventStreamOptions } from '@standardserver/node'

export interface NestStandardLazyRequest extends StandardLazyRequest {
  params?: undefined | Record<string, string | string[]>
}

export interface ToNestResponseConfig {
  eventStream?: undefined | ToEventStreamOptions
}

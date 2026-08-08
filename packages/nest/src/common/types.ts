import type { StandardLazyRequest } from '@standardserver/core'
import type { ToEventStreamOptions } from '@standardserver/node'

/**
 * A standard lazy request extended with NestJS route parameters,
 * used as the request representation inside the `@orpc/nest` integration.
 *
 * @see {@link https://orpc.dev/docs/integrations/nest#toneststandardlazyrequest-option | Implement oRPC contract with NestJS - toNestStandardLazyRequest option}
 */
export interface NestStandardLazyRequest extends StandardLazyRequest {
  /**
   * Route parameters extracted from the request path.
   */
  params?: undefined | Record<string, string | string[]>
}

/**
 * Configuration for converting a NestJS response,
 * currently used to customize event stream behavior.
 */
export interface ToNestResponseConfig {
  eventStream?: undefined | ToEventStreamOptions
}

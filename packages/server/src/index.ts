import { Builder } from './builder'
import { fallbackConfig } from './config'

export * from './builder'
export * from './builder-with-errors'
export * from './builder-with-middlewares'
export * from './config'
export * from './context'
export * from './lazy'
export * from './lazy-utils'
export * from './middleware'
export * from './middleware-decorated'
export * from './procedure'
export * from './procedure-builder'
export * from './procedure-builder-with-input'
export * from './procedure-builder-with-output'
export * from './procedure-builder-without-handler'
export * from './procedure-client'
export * from './procedure-decorated'
export * from './procedure-utils'
export * from './router'
export * from './router-accessible-lazy'
export * from './router-builder'
export * from './router-client'

export { isDefinedError, ORPCError, safe, type } from '@orpc/contract'

export const os = new Builder({
  route: {},
  meta: {},
  errorMap: {},
  inputSchema: undefined,
  outputSchema: undefined,
  inputValidationIndex: fallbackConfig('initialInputValidationIndex'),
  outputValidationIndex: fallbackConfig('initialOutputValidationIndex'),
})

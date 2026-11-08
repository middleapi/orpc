import type { Reporter } from 'augments-error'

export class AppError extends Error {
  code = 'APP'
}

/** Errors of a project where a package augments the global `Error` */
export interface Errors {
  app: AppError
  type: TypeError
  plain: Error
  reporter?: Reporter
}

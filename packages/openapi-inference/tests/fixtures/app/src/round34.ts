import { os, type } from '@orpc/server'

export const roundThirtyFourJSDoc = {
  /**
   * Get it
   * @summary
   */
  emptySummary: os.input(type<{ id: string }>()).handler(() => 1),
  /**
   * Describe it
   *
   * From the comment.
   * @description
   */
  emptyDescription: os.handler(() => 1),
}

/** Exports that are no router, for a `source` pointing at the wrong export */
export const notARouter = 1

export interface NotARouterShape {
  label: string
}

export function notARouterFunction(): number {
  return 1
}

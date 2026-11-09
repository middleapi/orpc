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

/** Two levels of one router, for a `source` pointing at the other level */
export const roundThirtyFourInner = {
  list: os.handler(() => 1),
  find: os.handler(() => 'x'),
}

export const roundThirtyFourOuter = { inner: roundThirtyFourInner }

/** Exports whose types expand generically, for a `source` pointing at the wrong export */
export interface Grow<T> {
  value: T
  next: Grow<Array<T>>
}

export declare const grow: Grow<number>

export class Chain<T> {
  constructor(readonly value: T) {}

  get wrapped(): Chain<{ v: T }> {
    return new Chain({ v: this.value })
  }
}

export const chain = new Chain(1)

/** A router nested in the same generic helper, which is no expansion */
function wrapRouter<T>(router: T): { inner: T } {
  return { inner: router }
}

export const roundThirtyFourWrapped = wrapRouter(
  wrapRouter(wrapRouter({ list: os.handler(() => 1) })),
)

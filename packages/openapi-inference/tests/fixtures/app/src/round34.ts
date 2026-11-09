import type { AnyProcedure } from '@orpc/server'
import { os, type } from '@orpc/server'
import * as z from 'zod'

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

/** Routers whose types are no plain objects, for a `source` pointing at another router */
const usersRouter = { users: { list: os.handler(() => [1]) } }
const postsRouter = { posts: { list: os.handler(() => ['p']) } }

export const assignedRouter = Object.assign({}, usersRouter, postsRouter)

export const nestedAssigned = { api: Object.assign({}, usersRouter, postsRouter) }

export declare const intersectedRouter: { a: AnyProcedure } & { b: AnyProcedure }

class Holder {
  list = os.handler(() => 1)
  find = os.handler(() => 'x')
}

export const heldRouter = new Holder()

export const heldService = { svc: new Holder() }

export const callableRouter = Object.assign(() => 1, { q: os.handler(() => 1) })

/** A library type with a large type graph, which holds no procedure */
export const userSchema = z.object({ id: z.string(), tags: z.array(z.string()).optional() })

/** A class that expands generically next to its procedure-free members */
export class Cursor<T> {
  constructor(readonly value: T) {}

  next(): Cursor<T[]> {
    return new Cursor([this.value])
  }

  get parent(): Cursor<{ child: T }> {
    return new Cursor({ child: this.value })
  }
}

export const cursor = new Cursor('x')

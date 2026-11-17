import type { AnyRouter } from '@orpc/server'
import { os } from '@orpc/server'

const usersRouter = { list: os.handler(() => [1]) }
const postsRouter = { list: os.handler(() => ['p']) }

// a flag the compiler does not know the value of
const dev = Math.random() > 1

// a factory of a lazy router, whose call the loader is not written in
// @ts-expect-error the module does not exist
const lazyMissing = () => os.lazy(() => import('./generator-missing-router'))

/**
 * Lazy routers whose types do not show the router they load: one from a factory, and one loading
 * a router typed `AnyRouter`
 */
export const unshownLazy = {
  factory: lazyMissing(),
  anyRouter: os.lazy(() => Promise.resolve({ default: usersRouter as AnyRouter })),
}

/**
 * Lazy routers of one of two loaders, of the same router or of different ones
 */
export const eitherLazy = {
  same: dev
    ? os.lazy(() => Promise.resolve({ default: usersRouter }))
    : os.lazy(async () => ({ default: usersRouter })),
  differing: dev
    ? os.lazy(() => Promise.resolve({ default: usersRouter }))
    : os.lazy(() => Promise.resolve({ default: postsRouter })),
}

class Ticks {
  [Symbol.asyncIterator]() {
    return {
      next: async (): Promise<{ done: false; value: number } | { done: true }> => ({
        done: true,
      }),
    }
  }
}

class Finished {
  [Symbol.asyncIterator]() {
    return {
      next: async (): Promise<{ done: true; value: string }> => ({ done: true, value: 'end' }),
    }
  }
}

class Untyped {
  [Symbol.asyncIterator]() {
    return { next: (): any => undefined }
  }
}

/**
 * Outputs of async iterables written by hand: one whose last result has no value, one that yields
 * nothing, and one whose results are not typed, and of the built-ins iterated synchronously
 */
export const handIterables = {
  ticks: os.handler(() => new Ticks()),
  finished: os.handler(() => new Finished()),
  untyped: os.handler(() => new Untyped()),
  set: os.handler((): Set<number> => new Set()),
  map: os.handler((): Map<string, number> => new Map()),
}

import { os } from '@orpc/server'

const usersRouter = { list: os.handler(() => [1]) }

/** A sub-router typed `any`, whose procedures have no types to infer from */
export const roundEightyFourAny = {
  health: os.handler(() => 'ok'),
  users: usersRouter as any,
}

/** An export typed `any`, which is no router, though the value is one */
export const roundEightyFourAnyExport: any = { health: os.handler(() => 'ok') }

// a loader written as resolving `any`, like an `import()` of a module path in a variable
const loadAny = (): Promise<any> => Promise.resolve({ default: usersRouter })
const assigned = os.lazy<typeof usersRouter>(loadAny)

/** Lazy routers given their router type, whose loaders are written as resolving `any` */
export const roundEightyFourLazy = {
  given: os.lazy<typeof usersRouter>(() => loadAny()),
  cast: os.lazy<typeof usersRouter>(
    () => Promise.resolve({ default: usersRouter }) as Promise<any>,
  ),
  assigned,
}

/** A lazy router given `any`, whose procedures have no types to infer from */
export const roundEightyFourLazyAny = {
  health: os.handler(() => 'ok'),
  users: os.lazy<any>(() => Promise.resolve({ default: usersRouter })),
}

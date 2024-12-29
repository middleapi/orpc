import type { RouterClient } from '@orpc/server'
import type { ORPCContext, ORPCContextValue } from './react-context'
import type { ORPCHooks } from './react-hooks'
import type { ORPCUtils } from './react-utils'
import type { UseQueries } from './use-queries/hook'
import { createORPCContext, useORPCContext } from './react-context'
import { createORPCHooks } from './react-hooks'
import { createORPCUtils } from './react-utils'
import { useQueriesFactory } from './use-queries/hook'

export type ORPCReact<T extends RouterClient<any, any>> =
  ORPCHooks<T> & {
    useContext: () => ORPCContextValue<T>
    useUtils: () => ORPCUtils<T>
    useQueries: UseQueries<T>
  }

export function createORPCReact<T extends RouterClient<any, any>>(): {
  orpc: ORPCReact<T>
  ORPCContext: ORPCContext<T>
} {
  const Context = createORPCContext<T>()
  const useContext = () => useORPCContext(Context)
  const useUtils = () => createORPCUtils({ contextValue: useContext() })
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const useQueries = useQueriesFactory({ context: Context })
  const hooks = createORPCHooks({ context: Context })

  const orpc = new Proxy(
    {
      useContext,
      useUtils,
      useQueries,
    },
    {
      get(target, key) {
        const value = Reflect.get(target, key)
        const nextHooks = Reflect.get(hooks, key)

        if (typeof value !== 'function') {
          return nextHooks
        }

        return new Proxy(value, {
          get(_, key) {
            return Reflect.get(nextHooks as any, key)
          },
        })
      },
    },
  )

  return { orpc: orpc as any, ORPCContext: Context }
}

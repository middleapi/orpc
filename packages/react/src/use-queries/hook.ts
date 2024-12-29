import type { RouterClient } from '@orpc/server'
import type {
  QueriesOptions,
  QueriesResults,
} from '@tanstack/react-query'
import type { ORPCContext } from '../react-context'
import type { UseQueriesBuilders } from './builders'
import { useQueries } from '@tanstack/react-query'
import { useORPCContext } from '../react-context'
import { createUseQueriesBuilders } from './builders'

export interface UseQueries<T extends RouterClient<any, any>> {
  <U extends Array<any> = [], UCombinedResult = QueriesResults<U>>(
    build: (
      builders: UseQueriesBuilders<T>,
    ) => [...QueriesOptions<U>],
    combine?: (result: QueriesResults<U>) => UCombinedResult,
  ): UCombinedResult
}

export interface UseQueriesFactoryOptions<T extends RouterClient<any, any>> {
  context: ORPCContext<T>
}

export function useQueriesFactory<T extends RouterClient<any, any>>(
  options: UseQueriesFactoryOptions<T>,
): UseQueries<T> {
  const Hook = (build: any, combine?: any): any => {
    const orpc = useORPCContext(options.context)
    const builders = createUseQueriesBuilders({ client: orpc.client })

    return useQueries({
      queries: build(builders),
      combine,
    })
  }

  return Hook
}

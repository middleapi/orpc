import type { RouterContractClient } from '@orpc/contract'
import type { RouterUtils } from '@orpc/tanstack-query'
import { contract } from './test'
import { contract2 } from './test2'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      utils?: RouterUtils<RouterContractClient<typeof allContract>>
    }
  }
}

export const allContract = {
  contract,
  contract2,
}

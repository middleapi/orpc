// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { openapi } from '@orpc/openapi'
import { os } from '@orpc/server'

/** An account the API answers with */
export interface CreatedAccount {
  id: string
}

export const roundThirtyEightJSDoc = {
  /**
   * Creates it
   * @returns The created account
   */
  created: os
    .route({ method: 'POST', path: '/created', successStatus: 201 })
    .handler((): CreatedAccount => ({ id: '1' })),
  /**
   * Finds it
   * @return The found account
   */
  found: os.handler((): CreatedAccount => ({ id: '1' })),
  /**
   * Updates it
   * @returns From the comment
   */
  updated: os
    .route({ successDescription: 'From the route' })
    .handler((): CreatedAccount => ({ id: '1' })),
  /**
   * Removes it
   * @returns From the comment
   */
  removed: os
    .meta(openapi({ successDescription: 'From the metadata' }))
    .handler((): CreatedAccount => ({ id: '1' })),
  /**
   * Lists them
   * @returns
   */
  listed: os.handler((): CreatedAccount[] => []),
}

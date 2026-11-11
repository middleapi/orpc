// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

/** A model whose form in a query string differs from its body form */
export interface Holder {
  bytes: Uint8Array
}

/** A model named like the query form of `Holder` */
export interface HolderParam {
  other: boolean
}

const queries = {
  named: os
    .route({ method: 'GET', path: '/named' })
    .input(type<{ named: HolderParam }>())
    .handler(() => 1),
  holder: os
    .route({ method: 'GET', path: '/holder' })
    .input(type<{ holder: Holder }>())
    .handler(() => 1),
}

/** Both models in query strings only */
export const queryNames = queries

/** `Holder` also in a request body */
export const bodyNames = {
  ...queries,
  upload: os
    .route({ method: 'POST', path: '/upload' })
    .input(type<Holder>())
    .handler(() => 1),
}

/** `HolderParam` in a request body, `Holder` in a query string */
export const mixedNames = {
  holder: queries.holder,
  upload: os
    .route({ method: 'POST', path: '/upload' })
    .input(type<HolderParam>())
    .handler(() => 1),
}

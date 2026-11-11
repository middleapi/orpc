// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

/** Typed arrays a client sends in the query string of a GET request, with Node's typings */
export const bufferQueries = {
  root: os
    .route({ method: 'GET', path: '/root' })
    .input(type<Uint8Array>())
    .handler(() => 1),
  post: os
    .route({ path: '/post' })
    .input(type<Uint8Array>())
    .handler(() => 1),
}

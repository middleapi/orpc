// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

/** Inputs a client sends in the query string, or with path parameters, not as the whole body */
export const bodylessBuiltins = {
  searchParams: os
    .route({ method: 'GET', path: '/search' })
    .input(type<URLSearchParams>())
    .handler(() => 1),
  readonlySearchParams: os
    .route({ method: 'GET', path: '/readonly-search' })
    .input(type<Readonly<URLSearchParams>>())
    .handler(() => 1),
  optionalSearchParams: os
    .route({ method: 'GET', path: '/optional-search' })
    .input(type<URLSearchParams | undefined>())
    .handler(() => 1),
  form: os
    .route({ method: 'GET', path: '/form' })
    .input(type<FormData>())
    .handler(() => 1),
  headForm: os
    .route({ method: 'HEAD', path: '/head-form' })
    .input(type<FormData>())
    .handler(() => 1),
  stream: os
    .route({ method: 'GET', path: '/stream' })
    .input(type<ReadableStream<Uint8Array>>())
    .handler(() => 1),
  postSearchParams: os
    .route({ method: 'POST', path: '/post-search' })
    .input(type<URLSearchParams>())
    .handler(() => 1),
}

// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

const form = (): FormData => {
  const data = new FormData()
  data.append('a', 'b')
  return data
}

/** A detailed structure whose root is a union, one member with a body built-in */
type FormOrJson = { body: FormData } | { body: { a: string } }

export const detailedUnions = {
  // a GET or HEAD request sends no body
  detailedFormGet: os
    .route({ inputStructure: 'detailed', method: 'GET' })
    .input(type<{ query: { a?: string }; body?: FormData }>())
    .handler(() => 1),
  detailedFormHead: os
    .route({ inputStructure: 'detailed', method: 'HEAD' })
    .input(type<{ query: { a?: string }; body?: FormData }>())
    .handler(() => 1),
  unionDetailedBody: os
    .route({ outputStructure: 'detailed' })
    .handler((): FormOrJson => ({ body: form() })),
  unionDetailedInput: os
    .route({ inputStructure: 'detailed' })
    .input(type<FormOrJson>())
    .handler(() => 1),
}

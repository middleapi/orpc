// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

interface UpdateThingInput {
  params: { id: string }
  query: { force?: boolean }
  headers: { 'x-token': string }
  body: { name: string; tags?: string[] }
}

export const router = {
  /**
   * Ignored first line
   * @summary Update a thing
   * @description Updates a thing by id.
   */
  update: os
    .route({
      method: 'PATCH',
      path: '/things/{id}',
      inputStructure: 'detailed',
      outputStructure: 'detailed',
    })
    .input(type<UpdateThingInput>())
    .handler(() => ({
      status: 202 as const,
      headers: { 'x-request-id': 'id' },
      body: { ok: true },
    })),
}

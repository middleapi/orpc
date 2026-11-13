// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

import { getState, loadProject } from './project-states'
import type { User } from './user-statuses'

interface Filter {
  mode: 'active' | 'inactive'
  flag: 'yes' | 'no'
}

/** Unions of literals the compiler interns for aliases of unrelated models, and written in place */
export const internedUnions = {
  user: os.handler((): User => ({ id: 'u', status: 'active' })),
  project: os.handler(() => ({ id: 'p', state: getState() })),
  filter: os
    .route({ method: 'GET', path: '/filter' })
    .input(type<Filter>())
    .handler(() => ({ ok: true })),
  row: os
    .route({ method: 'GET', path: '/rows/{id}' })
    .input(type<{ id: string }>())
    .handler(async ({ input }) => {
      const row = await loadProject(input.id)
      return { id: row.id, state: row.state }
    }),
  status: os
    .route({ method: 'GET', path: '/status' })
    .input(type<{ s?: User['status'] }>())
    .handler(() => 1),
}

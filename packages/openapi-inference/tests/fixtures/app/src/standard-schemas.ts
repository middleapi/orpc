// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'
import * as z from 'zod'

/** An array satisfies these by its members (`filter`, `sort`, `values`) */
export interface LooseFilter {
  filter: any
  page?: number
}

export type ObjectSort = { id: string; sort?: object }

export const splitParameters = {
  looseFilter: os
    .route({ method: 'GET', path: '/loose-filter' })
    .input(type<LooseFilter>())
    .handler(() => 1),
  objectSort: os
    .route({ method: 'GET', path: '/object-sort/{id}' })
    .input(type<ObjectSort>())
    .handler(() => 1),
  detailedValues: os
    .route({ method: 'POST', path: '/detailed-values', inputStructure: 'detailed' })
    .input(type<{ query: { values: unknown }; body: { filter?: object } }>())
    .handler(() => 1),
}

/** Zod schemas JSON Schema can not represent, like dates */
export const unconvertibleZod = {
  search: os
    .route({ method: 'GET', path: '/search' })
    .input(z.object({ q: z.string().optional(), from: z.coerce.date().optional() }))
    .handler(() => 1),
  stamp: os
    .route({ method: 'POST', path: '/stamp' })
    .input(z.object({ at: z.date(), note: z.string() }))
    .output(z.object({ at: z.date() }))
    .handler(() => ({ at: new Date(0) })),
}

/** Zod schemas whose conversions a test counts, one converting and one throwing */
export const countedNoteInput = z.object({ text: z.string() })
export const countedNoteOutput = z.object({ text: z.string(), at: z.date() })

export const countedConversions = {
  note: os
    .route({ method: 'POST', path: '/note' })
    .input(countedNoteInput)
    .output(countedNoteOutput)
    .handler(({ input }) => ({ ...input, at: new Date(0) })),
}

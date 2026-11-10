// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os } from '@orpc/server'
import * as z from 'zod'

/** Inputs of parameters-only procedures that Zod can not convert, of types not objects */
export const roundSeventy = {
  since: os
    .route({ method: 'GET', path: '/since' })
    .input(z.date().optional())
    .handler(() => 1),
  counts: os
    .route({ method: 'GET', path: '/counts' })
    .input(z.map(z.string(), z.number()))
    .handler(() => 1),
  tags: os
    .route({ method: 'GET', path: '/tags' })
    .input(z.custom<string[]>())
    .handler(() => 1),
  detailedSince: os
    .route({ method: 'POST', path: '/detailed-since', inputStructure: 'detailed' })
    .input(z.date().optional())
    .handler(() => 1),
  range: os
    .route({ method: 'GET', path: '/range' })
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date().optional() }))
    .handler(() => 1),
}

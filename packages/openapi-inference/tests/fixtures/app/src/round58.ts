// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

/** An instance is written by its `toJSON` in a body, but sent by its fields in a query */
export class SearchFilter {
  term = 't'
  limit?: number

  toJSON(): string {
    return this.term
  }
}

/** A plain object leaves its `toJSON` out */
export interface PageWindow {
  size: number
  toJSON(): 'all'
}

/** An instance is written as the set it extends */
export class LabelSet extends Set<string> {
  label = 'l'
}

/** An instance may be written by the date its `toJSON` returns, which `JSON.stringify` writes as `{}` */
export class DraftNote {
  id = 'd'
  toJSON?: () => Date
}

export interface TraceHeaders {
  'x-trace': string
  'toJSON'(): string
}

/** Inputs split into parameters, which a client reads from the fields of the value */
export const roundFiftyEightInputs = {
  search: os
    .route({ method: 'GET', path: '/search' })
    .input(type<SearchFilter>())
    .handler(() => 1),
  page: os
    .route({ method: 'GET', path: '/page' })
    .input(type<Readonly<PageWindow>>())
    .handler(() => 1),
  labels: os
    .route({ method: 'GET', path: '/labels' })
    .input(type<Pick<LabelSet, 'label'>>())
    .handler(() => 1),
  either: os
    .route({ method: 'GET', path: '/either' })
    .input(type<SearchFilter | PageWindow>())
    .handler(() => 1),
  term: os
    .route({ method: 'PATCH', path: '/term/{term}' })
    .input(type<SearchFilter>())
    .handler(() => 1),
  draft: os
    .route({ method: 'DELETE', path: '/draft/{id}' })
    .input(type<DraftNote>())
    .handler(() => 1),
  detailed: os
    .route({ method: 'POST', path: '/detailed', inputStructure: 'detailed' })
    .input(type<{ query: PageWindow; headers: TraceHeaders; body: SearchFilter }>())
    .handler(() => 1),
}

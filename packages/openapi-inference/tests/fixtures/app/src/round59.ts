// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

/** A plain object leaves its `toJSON` out, a client sends its fields */
export interface Jsonish {
  title: string
  toJSON(): string
}

export interface TraceHeaders {
  'x-trace': string
  'toJSON'(): string
}

// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type
export interface EmptyShape {}

export interface Labeled {
  label: string
}

/** An instance is written by its `toJSON` in a body, but sent by its fields in a query */
export class Money {
  amount = 1
  currency = 'usd'

  toJSON(): string {
    return `${this.amount} ${this.currency}`
  }
}

export class Circle {
  radius = 1
}

export interface PathId {
  id: string
}

/** Path params of a value declaring `toJSON` are its fields */
export interface JsonPath {
  id: string
  toJSON(): number
}

/**
 * Inputs split into parameters with an empty object a client may send, or unions of named types
 * declaring `toJSON`
 */
export const roundFiftyNineInputs = {
  object: os
    .route({ method: 'POST', path: '/object/{id}', inputStructure: 'detailed' })
    .input(type<{ params: { id: string }; query: { a: string } | object }>())
    .handler(() => 1),
  empty: os
    .route({ method: 'POST', path: '/empty/{id}', inputStructure: 'detailed' })
    // oxlint-disable-next-line typescript/no-empty-object-type
    .input(type<{ params: { id: string }; query: { q: string } | {} }>())
    .handler(() => 1),
  shape: os
    .route({ method: 'POST', path: '/shape/{id}', inputStructure: 'detailed' })
    .input(type<{ params: { id: string }; query: { a: string } | EmptyShape }>())
    .handler(() => 1),
  omitted: os
    .route({ method: 'POST', path: '/omitted/{id}', inputStructure: 'detailed' })
    .input(type<{ params: { id: string }; query: { a: string } | Omit<{ a: string }, 'a'> }>())
    .handler(() => 1),
  picked: os
    .route({ method: 'POST', path: '/picked/{id}', inputStructure: 'detailed' })
    .input(type<{ params: { id: string }; query: Pick<Labeled, never> | { a: string } }>())
    .handler(() => 1),
  sections: os
    .route({ method: 'GET', path: '/sections', inputStructure: 'detailed' })
    .input(type<{ query: Jsonish } | { headers: TraceHeaders }>())
    .handler(() => 1),
  getObject: os
    .route({ method: 'GET', path: '/get-object' })
    .input(type<{ a: string } | object>())
    .handler(() => 1),
  getMoney: os
    .route({ method: 'GET', path: '/get-money' })
    .input(type<Money | EmptyShape>())
    .handler(() => 1),
  refQuery: os
    .route({ method: 'POST', path: '/ref-query/{id}', inputStructure: 'detailed' })
    .input(type<{ params: PathId; query: Jsonish | { q: string } }>())
    .handler(() => 1),
  classQuery: os
    .route({ method: 'POST', path: '/class-query', inputStructure: 'detailed' })
    .input(type<{ query: Jsonish | Circle }>())
    .handler(() => 1),
  moneyQuery: os
    .route({ method: 'POST', path: '/money-query', inputStructure: 'detailed' })
    .input(type<{ query: Money | EmptyShape }>())
    .handler(() => 1),
  refHeaders: os
    .route({ method: 'POST', path: '/ref-headers', inputStructure: 'detailed' })
    .input(type<{ headers: TraceHeaders | { 'x-b': string } }>())
    .handler(() => 1),
  emptyHeaders: os
    .route({ method: 'POST', path: '/empty-headers', inputStructure: 'detailed' })
    // oxlint-disable-next-line typescript/no-empty-object-type
    .input(type<{ headers: TraceHeaders | {} }>())
    .handler(() => 1),
  refParams: os
    .route({ method: 'POST', path: '/ref-params/{id}', inputStructure: 'detailed' })
    .input(type<{ params: JsonPath | PathId }>())
    .handler(() => 1),
  optionalQuery: os
    .route({ method: 'GET', path: '/optional-query', inputStructure: 'detailed' })
    .input(type<{ query?: { a: string } }>())
    .handler(() => 1),
  optionalHeaders: os
    .route({ method: 'GET', path: '/optional-headers', outputStructure: 'detailed' })
    .output(type<{ headers?: { 'x-o': string }; body: number }>())
    .handler(() => ({ body: 1 })),
}

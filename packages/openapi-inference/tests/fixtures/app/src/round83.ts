// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

import UserCard from './round83-user-card'

export class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

/** Sent in a parameter as what `toString` returns */
export class Cents {
  constructor(public cents: number) {}

  toString(): string {
    return `${this.cents}c`
  }
}

/** Written as what its `toJSON` returns */
export class Priced {
  amount = 1

  toJSON(): string {
    return '1 USD'
  }
}

interface MaybeNumberJSON {
  toJSON?: () => number
}

/** An instance whose own `toJSON` may be missing, which leaves the class's one called */
const patched = (): Priced & MaybeNumberJSON => Object.assign(new Priced(), {} as MaybeNumberJSON)

/** `JSON.stringify` calls `toJSON` with no type argument, which may return anything */
class AnyJSON {
  name = 'x'

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- what is written
  toJSON<T>(): T {
    return undefined as T
  }
}

class WrappedJSON {
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- what is written
  toJSON<T>(): { value: T } {
    return { value: undefined as T }
  }
}

class StringJSON {
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- what is written
  toJSON<T extends string = 'a'>(): T {
    return 'a' as T
  }
}

/** `JSON.stringify` calls `toJSON` with the key, `''` at the root */
class KeyedJSON {
  toJSON(key: ''): { root: true }
  toJSON(key: string): string
  toJSON(key: string): unknown {
    return key === '' ? { root: true } : key
  }
}

/** A function written by its `toJSON`, which a view leaving it out may still hold */
type LabeledFunction = (() => number) & { toJSON(): string; label: string }

/** A conditional view, which maps the function and its `toJSON` to `{}` */
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T

const labeledFunction = (): LabeledFunction =>
  Object.assign(() => 1, { toJSON: () => 'json', label: 'l' })

const query = (path: `/${string}`) => os.route({ method: 'GET', path })

export interface SelfQuery {
  a: string
  self?: SelfQuery
}

/** Sent in the path by one procedure, and in the query by another */
export interface PathFilter {
  id: string | null
  tags: string[]
}

/** Procedures documented as the values they are sent or written as */
export const roundEightyThree = {
  // class instances in a query are sent as `String(value)`, plain objects by their fields
  classQuery: query('/class-query')
    .input(type<{ p: Point; m: Cents; e?: Error; list?: Point[] }>())
    .handler(() => 1),
  genericToJSON: os.handler(() => ({
    any: new AnyJSON(),
    wrapped: new WrappedJSON(),
    string: new StringJSON(),
  })),
  keyedRoot: os.handler(() => new KeyedJSON()),
  keyedNested: os.handler(() => ({ a: new KeyedJSON() })),
  viewedFunction: os.handler((): { f: Omit<LabeledFunction, 'toJSON'> } => ({
    f: labeledFunction(),
  })),
  deepViewedFunction: os.handler((): { f: DeepReadonly<LabeledFunction> } => ({
    f: labeledFunction(),
  })),
  viewedFunctionInput: os.input(type<{ f: Omit<LabeledFunction, 'toJSON'> }>()).handler(() => 1),
  pickLength: os.handler((): Pick<string[], 'length'> => 'abc'),
  gapIndexes: os.handler(
    (): { 0: string; 2: string } => ['a', 'b', 'c'] as [string, string, string],
  ),
  patched: os.handler(() => patched()),
  patchedNested: os.handler(() => ({ m: patched() })),
  patchedInput: os.input(type<{ m: Priced & MaybeNumberJSON }>()).handler(() => 1),
  partialToJSON: os.handler((): Priced & Partial<{ toJSON(): number }> =>
    Object.assign(new Priced(), {} as Partial<{ toJSON(): number }>),
  ),
  // bracket notation sends nothing for `null`, and for empty arrays, objects, and sets
  nullQuery: query('/null-query')
    .input(type<{ a: string | null; b: { c: number | null; d: (string | null)[] } }>())
    .handler(() => 1),
  // the fields of a query that may be missing, of a recursive type too
  recursiveQuery: os
    .route({ method: 'GET', path: '/recursive-query', inputStructure: 'detailed' })
    .input(type<{ query?: SelfQuery }>())
    .handler(() => 1),
  emptyQuery: query('/empty-query')
    .input(type<{ tags: string[]; filter: { a?: string }; s: Set<number>; t: []; n: number }>())
    .handler(() => 1),
  // a client sends a path parameter whole, and refuses an empty one, so it stays required
  nullPath: query('/null-path/{id}')
    .input(type<{ id: string | null; tags: string[] }>())
    .handler(() => 1),
  arrayPath: os
    .route({ method: 'POST', path: '/array-path/{tags}' })
    .input(type<{ tags: string[]; x: number }>())
    .handler(() => 1),
  detailedPath: os
    .route({ method: 'GET', path: '/detailed-path/{id}', inputStructure: 'detailed' })
    .input(type<{ params: { id: number | null }; query: { tags: string[] } }>())
    .handler(() => 1),
  // the parameter form of a type, documented first in the query
  filterQuery: query('/filter-query')
    .input(type<{ f: PathFilter }>())
    .handler(() => 1),
  filterPath: query('/filter-path/{id}')
    .input(type<PathFilter>())
    .handler(() => 1),
  // a client sends no header for `null`, and for an array of no line
  emptyHeaders: os
    .route({ method: 'GET', path: '/empty-headers', inputStructure: 'detailed' })
    .input(type<{ headers: { 'x-tags': string[]; 'x-n': string | null; 'x-s': string } }>())
    .handler(() => 1),
}

/** The procedures of `roundEightyThree` taking no input, whose outputs are written */
export const roundEightyThreeOutputs: readonly (keyof typeof roundEightyThree)[] = [
  'patched',
  'patchedNested',
  'partialToJSON',
  'genericToJSON',
  'keyedRoot',
  'keyedNested',
  'viewedFunction',
  'deepViewedFunction',
  'pickLength',
  'gapIndexes',
]

/** The inputs a client sends to each procedure of `roundEightyThree` taking one */
export const roundEightyThreeInputs: Record<string, () => unknown[]> = {
  classQuery: () => [
    { p: new Point(1, 2), m: new Cents(5), e: new Error('x'), list: [new Point(1, 2)] },
    { p: { x: 1, y: 2 }, m: { cents: 5 }, e: { name: 'E', message: 'm' }, list: [{ x: 1, y: 2 }] },
  ],
  patchedInput: () => [{ m: patched() }],
  viewedFunctionInput: () => [{ f: labeledFunction() }, { f: { label: 'l' } }],
  nullQuery: () => [
    { a: null, b: { c: null, d: [null, 'x'] } },
    { a: 'a', b: { c: 1, d: ['x'] } },
  ],
  recursiveQuery: () => [{}, { query: { a: 'a', self: { a: 'b' } } }],
  emptyQuery: () => [
    { tags: [], filter: {}, s: new Set(), t: [], n: 1 },
    { tags: ['a'], filter: { a: 'a' }, s: new Set([1]), t: [], n: 1 },
  ],
  nullPath: () => [
    { id: 'a', tags: [] },
    { id: 'a', tags: ['b'] },
  ],
  arrayPath: () => [{ tags: ['a', 'b'], x: 1 }],
  detailedPath: () => [{ params: { id: 1 }, query: { tags: [] } }],
  filterQuery: () => [{ f: { id: null, tags: [] } }],
  filterPath: () => [{ id: 'a', tags: [] }],
  emptyHeaders: () => [
    { headers: { 'x-tags': [], 'x-n': null, 'x-s': 's' } },
    { headers: { 'x-tags': [null], 'x-n': 'n', 'x-s': 's' } },
    { headers: { 'x-tags': ['a', 'b'], 'x-n': 'n', 'x-s': 's' } },
  ],
}

const makeCounter = () =>
  new (class {
    constructor(public count: number) {}
  })(1)

interface Tagged<T> {
  tag: T
}

/** Types named after their file, or by a printed type argument */
export const roundEightyThreeNames = {
  card: os.handler((): UserCard => new UserCard('a')),
  counter: os.handler(() => makeCounter()),
  month: os.handler((): Tagged<'2024-01'> => ({ tag: '2024-01' })),
  below: os.handler((): Tagged<-1> => ({ tag: -1 })),
}

export type Role = 'admin' | 'member'

/** A type only a query holds, whose component is named after it */
export const roundEightyThreeRoles = {
  list: query('/roles')
    .input(type<{ role?: Role }>())
    .handler(() => 1),
}

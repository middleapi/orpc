import { os, type } from '@orpc/server'

/** A date whose `toJSON` an intersection replaces, which only `JSON.stringify` calls */
export type StampedDate = Date & { toJSON(): number }

/** A set whose `toJSON` an intersection adds, which only `JSON.stringify` calls */
export type LabelledSet = Set<string> & { toJSON(): string }

export const stampedDate = (): StampedDate => Object.assign(new Date(0), { toJSON: () => 1 })
export const labelledSet = (): LabelledSet => Object.assign(new Set(['a']), { toJSON: () => 'set' })

/** Holds built-ins with an added `toJSON`, which `JSON.stringify` writes */
export class StampHolder {
  date: StampedDate = stampedDate()
  set: LabelledSet = labelledSet()
  dates: StampedDate[] = [stampedDate()]
}

/** A function with a field, which JSON leaves out */
export interface Handler extends Function {
  meta: string
}

export const handler = (): Handler => Object.assign(() => 1, { meta: 'm' })

/** Holds functions typed by interfaces extending `Function` */
export class FunctionHolder {
  callable: CallableFunction = () => 1
  newable: NewableFunction = StampHolder
  handler: Handler = handler()
  name = 'n'
}

/** A `toJSON` an intersection may add */
export interface Stamp {
  toJSON(): number
}

/** Holds built-ins whose added `toJSON` may be missing, so they may be written as the built-in */
export class MaybeStampHolder {
  // a plain `Date`, whose own `toJSON` the types do not let it have
  date: Date & { toJSON?(): number } = new Date(0) as Date & { toJSON?(): number }
  partialDate: Date & Partial<Stamp> = new Date(0) as Date & Partial<Stamp>
  set: Set<string> & { toJSON?(): string } = new Set(['a'])
  list: string[] & { toJSON?(): number } = ['a']
  stamped: Date & { toJSON?(): number } = stampedDate()
}

/** A function with a `toJSON`, which `JSON.stringify` calls */
export interface JsonFn extends Function {
  toJSON(): string
}

export const jsonFn = (): JsonFn => Object.assign(() => 1, { toJSON: () => 's' })

/** Holds a function typed by an interface extending `Function` with a `toJSON` */
export class JsonFnHolder {
  fn: JsonFn = jsonFn()
}

/** A function whose `toJSON` may be missing, written as nothing then */
export interface MaybeJsonFn extends Function {
  toJSON?(): string
}

/** Holds functions with a `toJSON`, in unions and lists */
export class JsonFnForms {
  added: (() => number) & { toJSON(): string } = Object.assign(() => 1, { toJSON: () => 'a' })
  maybe?: MaybeJsonFn = jsonFn()
  union: JsonFn | number = 3
  list: JsonFn[] = [jsonFn()]
}

/** Functions with a `toJSON`, and views of them, which may also hold plain objects */
export interface JsonFnViews {
  added: (() => number) & { toJSON(): string }
  fn: JsonFn
  view: Readonly<JsonFn>
  addedView: Readonly<(() => number) & { toJSON(): string }>
  partial?: Partial<JsonFn>
}

export const addedToJson = {
  stampHolder: os.handler((): StampHolder => new StampHolder()),
  readonlyStampHolder: os.handler((): Readonly<StampHolder> => new StampHolder()),
  plainStampHolder: os.handler(
    // oxlint-disable-next-line typescript/no-misused-spread -- the plain object under test
    (): Readonly<StampHolder> => ({ ...new StampHolder() }),
  ),
  plainStamps: os.handler(() => ({ date: stampedDate(), set: labelledSet() })),
  functionHolder: os.handler((): FunctionHolder => new FunctionHolder()),
  maybeStampHolder: os.handler((): MaybeStampHolder => new MaybeStampHolder()),
  readonlyMaybeStampHolder: os.handler((): Readonly<MaybeStampHolder> => new MaybeStampHolder()),
  jsonFnHolder: os.handler((): JsonFnHolder => new JsonFnHolder()),
  jsonFnForms: os.handler((): JsonFnForms => new JsonFnForms()),
  plainFunctions: os.handler(
    (): { callable: CallableFunction; handler: Handler; list: Handler[]; name: string } => ({
      callable: () => 1,
      handler: handler(),
      list: [handler()],
      name: 'n',
    }),
  ),
}

export const addedToJsonInputs = {
  stampHolder: os.input(type<StampHolder>()).handler(() => 1),
  functionHolder: os.input(type<FunctionHolder>()).handler(() => 1),
  maybeStampHolder: os.input(type<MaybeStampHolder>()).handler(() => 1),
  jsonFnHolder: os.input(type<JsonFnHolder>()).handler(() => 1),
  jsonFnForms: os.input(type<JsonFnForms>()).handler(() => 1),
  jsonFnViews: os.input(type<JsonFnViews>()).handler(() => 1),
}

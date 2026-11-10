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

export const roundFortySix = {
  stampHolder: os.handler((): StampHolder => new StampHolder()),
  readonlyStampHolder: os.handler((): Readonly<StampHolder> => new StampHolder()),
  plainStampHolder: os.handler(
    // oxlint-disable-next-line typescript/no-misused-spread -- the plain object under test
    (): Readonly<StampHolder> => ({ ...new StampHolder() }),
  ),
  plainStamps: os.handler(() => ({ date: stampedDate(), set: labelledSet() })),
  functionHolder: os.handler((): FunctionHolder => new FunctionHolder()),
  plainFunctions: os.handler(
    (): { callable: CallableFunction; handler: Handler; list: Handler[]; name: string } => ({
      callable: () => 1,
      handler: handler(),
      list: [handler()],
      name: 'n',
    }),
  ),
}

export const roundFortySixInputs = {
  stampHolder: os.input(type<StampHolder>()).handler(() => 1),
  functionHolder: os.input(type<FunctionHolder>()).handler(() => 1),
}

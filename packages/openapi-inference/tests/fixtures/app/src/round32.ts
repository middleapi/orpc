// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

/** A boolean view a plain object holding `valueOf` satisfies */
export type PlainBoolean = Omit<boolean, 'k'>

const plainBoolean: PlainBoolean = { valueOf: () => true }
const pickedBoolean: Pick<boolean, 'valueOf'> = { valueOf: () => false }

/** A class whose `toJSON` is typed `any` */
export class AnyJSONField {
  a = 1
  // oxlint-disable-next-line typescript/no-explicit-any
  toJSON: any = () => ({ q: 1 })
}

/** A class whose `toJSON` is typed `unknown` */
export class UnknownJSONField {
  a = 1
  toJSON: unknown = () => ({ q: 1 })
}

/** A class whose `toJSON` has overloads, one taking the key */
export class OverloadedJSON {
  a = 1
  toJSON(): string
  toJSON(key: string): number
  toJSON(key?: string): string | number {
    return key === undefined ? 's' : 1
  }
}

/** Views of primitives, toJSON typed any or overloaded, and mapped types without keys */
export const roundThirtyTwo = {
  plainBooleans: os.handler(
    (): {
      v: PlainBoolean
      picked: Pick<boolean, 'valueOf'>
      frozen: Readonly<PlainBoolean>
      list: PlainBoolean[]
    } => ({
      v: plainBoolean,
      picked: pickedBoolean,
      frozen: plainBoolean,
      list: [plainBoolean, true],
    }),
  ),
  plainBooleanRoot: os.handler((): PlainBoolean => plainBoolean),
  anyToJSON: os.handler(
    (): { any: AnyJSONField; unknown: UnknownJSONField; list: AnyJSONField[] } => ({
      any: new AnyJSONField(),
      unknown: new UnknownJSONField(),
      list: [new AnyJSONField()],
    }),
  ),
  overloadedToJSON: os.handler((): { t: OverloadedJSON; list: OverloadedJSON[] } => ({
    t: new OverloadedJSON(),
    list: [new OverloadedJSON()],
  })),
  overloadedToJSONRoot: os.handler((): OverloadedJSON => new OverloadedJSON()),
  // a mapped type without keys holds functions, which JSON leaves out
  keylessViews: os.handler((): { o: Omit<{ a: number }, 'a'>; p: Pick<{ a: number }, never> } => ({
    o: () => 1,
    p: () => 1,
  })),
}

/** Inputs of views of primitives */
export const roundThirtyTwoInputs = {
  plainBoolean: os.input(type<{ v: PlainBoolean }>()).handler(() => 1),
  plainBooleanRoot: os.input(type<PlainBoolean>()).handler(() => 1),
}

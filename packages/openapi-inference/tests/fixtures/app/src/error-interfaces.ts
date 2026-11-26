/* oxlint-disable typescript/no-wrapper-object-types -- a boxed number toJSON returns */
import { os, type } from '@orpc/server'

/** An interface extending an error, whose `Set` and `Map` fields an instance writes as `{}` */
export interface TaggedError extends Error {
  tags: Set<string>
  counts: Map<string, number>
}

export interface TaggedErrorHolder {
  error: TaggedError
}

export const taggedError = (): TaggedError =>
  Object.assign(new TypeError('e'), { tags: new Set(['a']), counts: new Map([['a', 1]]) })

export const plainTaggedError = (): TaggedError => ({
  name: 'E',
  message: 'p',
  tags: new Set(['b']),
  counts: new Map([['b', 2]]),
})

/** A function with a `toJSON`, which `JSON.stringify` does not call on a value `toJSON` returned */
export type JsonFn = (() => number) & { toJSON(): number }

export class Relay {
  n = 1
}

/** Written as nothing, the function its `toJSON` returns */
export type RelayJson = Relay & { toJSON(): JsonFn }

const relayJson = (): RelayJson =>
  Object.assign(new Relay(), { toJSON: () => Object.assign(() => 1, { toJSON: () => 2 }) })

export class RelayHolder {
  relay: RelayJson = relayJson()
  list: RelayJson[] = [relayJson()]
}

export const relays = (): { relay: RelayJson; view: Readonly<RelayJson>; list: RelayJson[] } => ({
  relay: relayJson(),
  view: relayJson(),
  list: [relayJson()],
})

/** Interfaces extending a view of an error, whose instances `JSON.stringify` writes */
export interface CodedError extends Readonly<Error> {
  code: string
  toJSON(): string
}

export interface MessageTags extends Pick<Error, 'message'> {
  tags: Set<string>
}

/** Views of an intersection with a view of a built-in, which may hold the built-in */
export interface BuiltinViewJson {
  date: Readonly<Pick<Date, 'getTime'> & { toJSON(): { at: number } }>
  set: Readonly<Readonly<Set<string>> & { toJSON(): string }>
}

/** Its `toJSON` returns a boxed number, written as the number without calling its own `toJSON` */
export class BoxedResult {
  toJSON(): Readonly<Number> & { toJSON(): { n: number } } {
    return Object.assign(new Number(5), { toJSON: () => ({ n: 5 }) })
  }
}

/** An interface extending a date, which `JSON.stringify` writes by its own fields when `toJSON` returns it */
export interface LabeledInstant extends Date {
  zone: string
}

export class InstantOwner {
  toJSON(): LabeledInstant {
    return Object.assign(new Date(0), { zone: 'UTC' })
  }
}

/** Its `toJSON` returns a set, written as `{}` without calling the set's own `toJSON` */
export class SetResult {
  toJSON(): Partial<Readonly<Set<string>> & { toJSON(): number }> {
    return Object.assign(new Set(['a']), { toJSON: () => 0 })
  }
}

export const codedErrors = (): CodedError[] => [
  Object.assign(new Error('e'), { code: 'c', toJSON: () => 'coded' }),
  { name: 'E', message: 'p', code: 'c', toJSON: () => 'plain' },
]

export const messageTags = (): MessageTags[] => [
  Object.assign(new Error('e'), { tags: new Set(['a']) }),
  { message: 'p', tags: new Set(['b']) },
]

export const builtinViewJson = (): BuiltinViewJson[] => [
  {
    date: Object.assign(new Date(0), { toJSON: () => ({ at: 0 }) }),
    set: Object.assign(new Set(['a']), { toJSON: () => 's' }),
  },
  {
    date: { getTime: () => 0, toJSON: () => ({ at: 0 }) },
    set: Object.assign(new Set(['b']), { toJSON: () => 's' }),
  },
]

export const errorSubtypes = {
  taggedError: os.handler(taggedError),
  plainTaggedError: os.handler(plainTaggedError),
  taggedErrorHolder: os.handler((): TaggedErrorHolder => ({ error: taggedError() })),
  relays: os.handler(relays),
  relayHolder: os.handler((): RelayHolder => new RelayHolder()),
  codedErrors: os.handler(codedErrors),
  messageTags: os.handler(messageTags),
  builtinViewJson: os.handler(builtinViewJson),
  builtinViewJsonRoot: os.handler((): BuiltinViewJson['date'] =>
    Object.assign(new Date(0), { toJSON: () => ({ at: 0 }) }),
  ),
  boxedResult: os.handler((): { box: BoxedResult } => ({ box: new BoxedResult() })),
  instantOwner: os.handler((): { owner: InstantOwner } => ({ owner: new InstantOwner() })),
  setResult: os.handler((): { result: SetResult } => ({ result: new SetResult() })),
}

export const errorSubtypesInputs = {
  taggedError: os.input(type<TaggedError>()).handler(() => 1),
  taggedErrorHolder: os.input(type<TaggedErrorHolder>()).handler(() => 1),
  codedErrors: os.input(type<CodedError[]>()).handler(() => 1),
  messageTags: os.input(type<MessageTags[]>()).handler(() => 1),
  relays: os
    .input(type<{ relay: RelayJson; view: Readonly<RelayJson>; list: RelayJson[] }>())
    .handler(() => 1),
}

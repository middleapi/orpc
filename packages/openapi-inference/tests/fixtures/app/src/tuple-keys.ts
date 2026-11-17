import { os } from '@orpc/server'

export type Entry = [string, number, Date]

/** The members of a tuple by its string keys: its indexes and the members of arrays */
export type KeyedEntry = { [K in keyof Entry & string]: Entry[K] }

export const tupleKeys = {
  keyedEntry: os.handler((): KeyedEntry => ['a', 1, new Date(0)]),
  keyedEntries: os.handler((): { [K in keyof Entry & string]?: Entry[K] }[] => [
    ['a', 1, new Date(0)],
  ]),
}

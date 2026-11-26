import { eventIterator, os, type } from '@orpc/server'
import type { PositiveInfinity } from 'type-fest'
import * as z from 'zod'

import type { Shelf } from './generator-partly-installed'
// @ts-expect-error the module does not exist
import type { Missing } from './jsdoc-sources/missing'

/**
 * Inputs Zod documents as any value, whose types the compiler can resolve and send, or not
 */
export const unreadableCustomTypes = {
  readable: os.input(z.custom<{ id: string }>()).handler(() => 'ok'),
  unresolved: os.input(z.custom<{ id: Missing }>()).handler(() => 'ok'),
  infinite: os.input(z.custom<{ max: PositiveInfinity }>()).handler(() => 'ok'),
}

/**
 * Event iterators whose yields one schema describes, returning different types
 */
export const describedYields = {
  events: os
    .output(eventIterator(z.object({ id: z.string() }), type<{ total: number }>()))
    .output(eventIterator(type<{ id: string }>(), type<{ done: boolean }>()))
    .handler(async function* () {
      yield { id: 'a' }
      return { total: 1, done: true }
    }),
}

/**
 * A procedure without schemas, with an error without data
 */
export const schemaless = {
  ping: os.errors({ GONE: {} }).handler(() => 'pong'),
}

/**
 * An output declared by a declaration file importing a module the compiler does not find
 */
export const partlyInstalled = {
  shelf: os.handler((): Shelf => ({ origin: { x: 1 }, inner: {} as never })),
}

export const taggedJSDoc = {
  /**
   * Pings it
   * @tag health, ping
   * @example ping()
   * @returns
   */
  ping: os.handler(() => 'pong'),
}

import { os, type } from '@orpc/server'
import * as z from 'zod'

import type { CreateUserInput, Showcase, User } from '@/models'

// values are imported relatively, the test runner does not read the tsconfig's paths
import { Account, Money } from './models'

const toUser = (input: CreateUserInput): User => ({
  ...input,
  id: 'u_1' as User['id'],
  createdAt: new Date(0),
})

export const router = {
  /** Find the current user */
  me: os.handler(() =>
    toUser({ name: 'Alice', role: 'admin', score: 4.5, nickname: null, location: [1, 2] }),
  ),

  createUser: os.input(type<CreateUserInput>()).handler(({ input }) => toUser(input)),

  greet: os
    .input(z.object({ name: z.string().min(2) }))
    .handler(({ input }) => ({ greeting: `hello ${input.name}`, at: new Date(0) })),

  echo: os
    .input(z.object({ text: z.string().max(10) }))
    .output(z.object({ text: z.string() }))
    .handler(({ input }) => input),

  complex: os.handler((): Showcase => ({
    shapes: [
      { kind: 'circle', radius: 1 },
      { kind: 'rect', width: 2, height: 3 },
    ],
    tree: { name: 'root', children: [{ name: 'leaf', children: [] }] },
    page: { items: [{ kind: 'circle', radius: 2 }], next: null },
    event: 'onHover',
    slug: 'user-1',
    patch: { theme: { dark: true } },
    frozen: { theme: { color: 'red', dark: false }, limits: { daily: 1 } },
    flat: { a: 'a', b: 1 },
    getters: { getVersion: 1, getLabel: 'v1' },
    unwrapped: 1,
  })),

  natives: os.handler(() => ({
    at: new Date(0),
    big: 10n,
    tags: new Set(['a', 'b']),
    scores: new Map([['a', 1]]),
    money: new Money(5, 'USD'),
    account: new Account('bob', new Money(1, 'EUR'), new Date(0)),
  })),

  events: os.handler(async function* () {
    yield { tick: 1, at: new Date(0) }
    yield { tick: 2, at: new Date(1) }
    return 'done' as const
  }),
}

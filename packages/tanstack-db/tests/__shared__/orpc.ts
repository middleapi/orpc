import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { QueryClient } from '@tanstack/query-core'
import z from 'zod'
import { createTanstackDBUtils } from '../../src'

export const todoSchema = z.object({
  id: z.number(),
  name: z.string(),
})

export interface Todo {
  id: number
  name: string
}

export const todos: Todo[] = []

export function resetTodos(): void {
  todos.splice(0, todos.length, { id: 1, name: 'first' })
}

export const router = {
  todo: {
    list: os
      .errors({ LIST_ERROR: { data: z.object({ list: z.string() }) } })
      .input(z.object({ search: z.string() }).optional())
      .output(z.array(todoSchema))
      .handler(vi.fn(({ input }) => todos.filter(todo => todo.name.includes(input?.search ?? '')))),
    create: os
      .input(todoSchema)
      .output(todoSchema)
      .handler(vi.fn(({ input }) => {
        todos.push(input)
        return input
      })),
    update: os
      .input(z.object({ id: z.number(), data: todoSchema.partial() }))
      .output(todoSchema)
      .handler(vi.fn(({ input }) => {
        const todo = todos.find(todo => todo.id === input.id)!
        Object.assign(todo, input.data)
        return todo
      })),
    delete: os
      .input(z.object({ id: z.number() }))
      .handler(vi.fn(({ input }) => {
        todos.splice(todos.findIndex(todo => todo.id === input.id), 1)
      })),
  },
}

const handler = new RPCHandler(router)

// prefer createORPCClient over createRouterClient for more close realistic
export const client: RouterClient<typeof router, { cache?: boolean }> = createORPCClient(new RPCLink({
  origin: 'http://localhost',
  fetch: async (url, init) => {
    const { response } = await handler.handle(new Request(url, init))
    return response ?? new Response('Not Found', { status: 404 })
  },
}))

export const orpc = createTanstackDBUtils(client)

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

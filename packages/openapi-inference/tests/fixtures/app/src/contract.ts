import { oc, type } from '@orpc/contract'
import { implement } from '@orpc/server'

export interface Todo {
  id: string
  title: string
  done: boolean
}

export const contract = {
  todo: {
    /**
     * Get a todo
     * Fetches one todo.
     * @tags todos
     */
    get: oc.input(type<{ id: string }>()).output(type<Todo | undefined>()),
    list: oc.output(type<Todo[]>()),
  },
}

const os = implement(contract)

export const implemented = os.router({
  todo: {
    get: os.todo.get.handler(() => undefined),
    list: os.todo.list.handler(() => []),
  },
})

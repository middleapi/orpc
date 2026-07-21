import { createCollection } from '@tanstack/db'
import { client, orpc, queryClient } from './__shared__/orpc'

it('.key', () => {
  orpc.key()
  orpc.todo.key({ type: 'query' })
  orpc.todo.list.key({ input: { search: '__search__' } })
  // @ts-expect-error --- input is invalid
  orpc.todo.list.key({ input: { search: 123 } })
})

it('.call', () => {
  expectTypeOf(orpc.todo.list.call).toEqualTypeOf(client.todo.list)
})

it('.collectionOptions with createCollection', () => {
  const collection = createCollection(orpc.todo.list.collectionOptions({
    input: { search: '__search__' },
    queryClient,
    getKey: todo => todo.id,
    onInsert: orpc.todo.create.mutationHandler({
      input: mutation => mutation.modified,
    }),
    onUpdate: orpc.todo.update.mutationHandler({
      input: mutation => ({ id: mutation.key, data: mutation.changes }),
    }),
    onDelete: orpc.todo.delete.mutationHandler({
      input: mutation => ({ id: mutation.key }),
    }),
  }))

  const todo = collection.get(1)
  expectTypeOf(todo?.id).toEqualTypeOf<number | undefined>()
  expectTypeOf(todo?.name).toEqualTypeOf<string | undefined>()

  collection.insert({ id: 1, name: '__name__' })
  // @ts-expect-error --- invalid item
  collection.insert({ id: '__invalid__' })
})

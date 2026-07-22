import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { createCollection } from '@tanstack/db'
import { client, orpc, queryClient, resetTodos, router, todos } from './__shared__/orpc'

beforeEach(() => {
  resetTodos()
  queryClient.clear()
  vi.clearAllMocks()
})

it('syncs a collection through oRPC procedures', async () => {
  const collection = createCollection(orpc.todo.list.collectionOptions({
    input: () => ({ search: '' }),
    queryClient,
    getKey: todo => todo.id,
    startSync: true,
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

  await collection.preload()
  expect(collection.toArray).toMatchObject([{ id: 1, name: 'first' }])

  const insertTx = collection.insert({ id: 2, name: 'second' })
  await insertTx.isPersisted.promise
  expect(router.todo.create['~orpc'].handler).toHaveBeenCalledTimes(1)
  expect(todos).toEqual([{ id: 1, name: 'first' }, { id: 2, name: 'second' }])
  expect(collection.toArray).toMatchObject([{ id: 1, name: 'first' }, { id: 2, name: 'second' }])

  const updateTx = collection.update(2, (draft) => {
    draft.name = 'updated'
  })
  await updateTx.isPersisted.promise
  expect(router.todo.update['~orpc'].handler).toHaveBeenCalledTimes(1)
  expect(collection.toArray).toMatchObject([{ id: 1, name: 'first' }, { id: 2, name: 'updated' }])

  const deleteTx = collection.delete(1)
  await deleteTx.isPersisted.promise
  expect(router.todo.delete['~orpc'].handler).toHaveBeenCalledTimes(1)
  expect(collection.toArray).toMatchObject([{ id: 2, name: 'updated' }])
})

it('shares query keys with @orpc/tanstack-query utils', async () => {
  const tanstackQueryUtils = createTanstackQueryUtils(client)

  const collection = createCollection(orpc.todo.list.collectionOptions({
    input: () => ({ search: '' }),
    queryClient,
    getKey: todo => todo.id,
    startSync: true,
  }))

  await collection.preload()

  expect(queryClient.getQueryData(tanstackQueryUtils.todo.list.queryKey())).toEqual([{ id: 1, name: 'first' }])
  expect(orpc.todo.list.key({ type: 'query' })).toEqual(tanstackQueryUtils.todo.list.key({ type: 'query' }))
})

it('supports refetch option', async () => {
  const collection = createCollection(orpc.todo.list.collectionOptions({
    input: () => ({ search: '' }),
    queryClient,
    getKey: todo => todo.id,
    startSync: true,
    onInsert: orpc.todo.create.mutationHandler({
      input: mutation => mutation.modified,
      refetch: false,
    }),
  }))

  await collection.preload()
  const listCalls = vi.mocked(router.todo.list['~orpc'].handler).mock.calls.length

  const insertTx = collection.insert({ id: 2, name: 'second' })
  await insertTx.isPersisted.promise

  expect(router.todo.create['~orpc'].handler).toHaveBeenCalledTimes(1)
  expect(router.todo.list['~orpc'].handler).toHaveBeenCalledTimes(listCalls)
})

it('supports schema option', async () => {
  const { todoSchema } = await import('./__shared__/orpc')

  const collection = createCollection(orpc.todo.list.collectionOptions({
    input: () => ({ search: 'first' }),
    queryClient,
    schema: todoSchema,
    getKey: todo => todo.id,
    startSync: true,
  }))

  await collection.preload()
  expect(collection.toArray).toMatchObject([{ id: 1, name: 'first' }])
})

import type { Client } from '@orpc/client'
import type { DeleteMutationFn, InsertMutationFn, UpdateMutationFn } from '@tanstack/db'
import type { QueryCollectionUtils } from '@tanstack/query-db-collection'
import type { ProcedureUtils } from './procedure-utils'
import { QueryClient } from '@tanstack/query-core'
import z from 'zod'

describe('ProcedureUtils', () => {
  interface Todo {
    id: number
    name: string
  }

  type ListInput = { search?: string } | undefined

  const queryClient = new QueryClient()

  const listUtils = {} as ProcedureUtils<{ batch?: boolean }, ListInput, Todo[], Error>
  const requiredInputListUtils = {} as ProcedureUtils<{ batch?: boolean }, { search: string }, Todo[], Error>
  const requiredContextListUtils = {} as ProcedureUtils<{ batch: boolean }, ListInput, Todo[], Error>
  const nonArrayListUtils = {} as ProcedureUtils<{ batch?: boolean }, ListInput, { items: Todo[] }, Error>
  const createUtils = {} as ProcedureUtils<{ batch?: boolean }, Todo, Todo, Error>
  const updateUtils = {} as ProcedureUtils<{ batch?: boolean }, { id: number, data: Partial<Todo> }, Todo, Error>

  it('.call', () => {
    expectTypeOf(listUtils.call).toEqualTypeOf<
      Client<{ batch?: boolean }, ListInput, Todo[], Error>
    >()
  })

  describe('.collectionOptions', () => {
    it('infers item type from procedure output', () => {
      const options = listUtils.collectionOptions({
        queryClient,
        getKey: (item) => {
          expectTypeOf(item).toEqualTypeOf<Todo>()
          return item.id
        },
      })

      expectTypeOf(options.utils).toEqualTypeOf<QueryCollectionUtils<Todo, number, Todo, Error>>()
    })

    it('handles `input` correctly', () => {
      listUtils.collectionOptions({ queryClient, getKey: item => item.id })
      listUtils.collectionOptions({ input: { search: '__search__' }, queryClient, getKey: item => item.id })
      // @ts-expect-error --- input is invalid
      listUtils.collectionOptions({ input: { search: 123 }, queryClient, getKey: item => item.id })

      requiredInputListUtils.collectionOptions({ input: { search: '__search__' }, queryClient, getKey: item => item.id })
      // @ts-expect-error --- input is required
      requiredInputListUtils.collectionOptions({ queryClient, getKey: item => item.id })
    })

    it('handles `context` correctly', () => {
      listUtils.collectionOptions({ queryClient, getKey: item => item.id })
      listUtils.collectionOptions({ context: { batch: true }, queryClient, getKey: item => item.id })
      // @ts-expect-error --- context is invalid
      listUtils.collectionOptions({ context: { batch: 'invalid' }, queryClient, getKey: item => item.id })

      requiredContextListUtils.collectionOptions({ context: { batch: true }, queryClient, getKey: item => item.id })
      // @ts-expect-error --- context is required
      requiredContextListUtils.collectionOptions({ queryClient, getKey: item => item.id })
    })

    it('infers item type from `select`', () => {
      const options = nonArrayListUtils.collectionOptions({
        queryClient,
        select: (data) => {
          expectTypeOf(data).toEqualTypeOf<{ items: Todo[] }>()
          return data.items
        },
        getKey: (item) => {
          expectTypeOf(item).toEqualTypeOf<Todo>()
          return item.id
        },
      })

      expectTypeOf(options.utils).toEqualTypeOf<QueryCollectionUtils<Todo, number, Todo, Error>>()
    })

    it('requires `select` when output is not an array', () => {
      // @ts-expect-error --- select is required
      nonArrayListUtils.collectionOptions({ queryClient, getKey: (item: any) => item.id })
    })

    it('infers item type from `schema`', () => {
      const todoSchema = z.object({ id: z.number(), name: z.string() })

      const options = listUtils.collectionOptions({
        queryClient,
        schema: todoSchema,
        getKey: (item) => {
          expectTypeOf(item).toEqualTypeOf<{ id: number, name: string }>()
          return item.id
        },
      })

      expectTypeOf(options.schema).toEqualTypeOf<typeof todoSchema>()
      expectTypeOf(options.utils).toEqualTypeOf<QueryCollectionUtils<{ id: number, name: string }, number, { id: number, name: string }, Error>>()

      nonArrayListUtils.collectionOptions({
        queryClient,
        schema: todoSchema,
        select: (data) => {
          expectTypeOf(data).toEqualTypeOf<{ items: Todo[] }>()
          return data.items
        },
        getKey: item => item.id,
      })
    })

    it('supports persistence handlers', () => {
      listUtils.collectionOptions({
        queryClient,
        getKey: item => item.id,
        onInsert: createUtils.mutationHandler({ input: mutation => mutation.modified }),
        onUpdate: updateUtils.mutationHandler({ input: mutation => ({ id: mutation.key, data: mutation.changes }) }),
      })
    })
  })

  describe('.mutationHandler', () => {
    it('enforces input mapper return type', () => {
      createUtils.mutationHandler({ input: mutation => mutation.modified })
      // @ts-expect-error --- input is invalid
      createUtils.mutationHandler({ input: () => ({ id: 'invalid' }) })
      // @ts-expect-error --- input is required
      createUtils.mutationHandler()
    })

    it('optional options when input & context are optional', () => {
      listUtils.mutationHandler()
      listUtils.mutationHandler({})
      listUtils.mutationHandler({ input: () => ({ search: '__search__' }) })

      // @ts-expect-error --- context is required
      requiredContextListUtils.mutationHandler()
      requiredContextListUtils.mutationHandler({ context: { batch: true } })
    })

    it('is assignable to TanStack DB persistence handlers', () => {
      const handler = createUtils.mutationHandler({ input: mutation => mutation.modified })

      expectTypeOf(handler).toExtend<InsertMutationFn<Todo, number>>()
      expectTypeOf(handler).toExtend<UpdateMutationFn<Todo, number>>()
      expectTypeOf(handler).toExtend<DeleteMutationFn<Todo, number>>()
    })

    it('supports explicit item & operation types', () => {
      createUtils.mutationHandler<Todo, 'insert'>({
        input: (mutation) => {
          expectTypeOf(mutation.modified).toEqualTypeOf<Todo>()
          expectTypeOf(mutation.type).toEqualTypeOf<'insert'>()
          return mutation.modified
        },
      })

      updateUtils.mutationHandler<Todo, 'update'>({
        input: (mutation) => {
          expectTypeOf(mutation.original).toEqualTypeOf<Todo>()
          expectTypeOf(mutation.changes).toEqualTypeOf<Partial<Todo>>()
          return { id: mutation.original.id, data: mutation.changes }
        },
      })
    })

    it('infers return type from `output`', () => {
      const handler = updateUtils.mutationHandler({
        input: mutation => ({ id: mutation.key, data: mutation.changes }),
        output: (outputs) => {
          expectTypeOf(outputs).toEqualTypeOf<Todo[]>()
          return { txid: outputs.length }
        },
      })

      expectTypeOf(handler).returns.resolves.toEqualTypeOf<{ txid: number }>()

      const defaultHandler = updateUtils.mutationHandler({
        input: mutation => ({ id: mutation.key, data: mutation.changes }),
      })

      expectTypeOf(defaultHandler).returns.resolves.toEqualTypeOf<Todo[]>()
    })
  })
})

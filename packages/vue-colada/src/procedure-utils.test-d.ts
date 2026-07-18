import type { Client } from '@orpc/client'
import type { ORPCErrorFromErrorMap } from '@orpc/contract'
import type { Public } from '@orpc/shared'
import type { ProcedureUtils } from './procedure-utils'
import { useMutation, useQuery } from '@pinia/colada'
import { computed } from 'vue'
import z from 'zod'

const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })

const baseErrorMap = {
  BASE: {
    data: outputSchema,
  },
  OVERRIDE: {},
}

describe('ProcedureUtils', () => {
  type UtilsInput = { search?: string, cursor?: number } | undefined
  type UtilsOutput = { title: string }[]
  type UtilsError = ORPCErrorFromErrorMap<typeof baseErrorMap>

  const utils = {} as Public<ProcedureUtils<
    { batch?: boolean },
    UtilsInput,
    UtilsOutput,
    UtilsError
  >>

  it('.call', () => {
    expectTypeOf(utils.call).toEqualTypeOf<
      Client<
        { batch?: boolean },
        UtilsInput,
        UtilsOutput,
        UtilsError
      >
    >()
  })

  describe('.queryOptions', () => {
    it('can optional options', () => {
      const requiredUtils = {} as Public<ProcedureUtils<{ batch?: boolean }, 'input', UtilsOutput, Error>>

      utils.queryOptions()
      utils.queryOptions({ context: { batch: true } })
      utils.queryOptions({ input: { search: 'search' } })

      requiredUtils.queryOptions({
        context: { batch: true },
        input: 'input',
      })
      // @ts-expect-error input and context is required
      requiredUtils.queryOptions()
      // @ts-expect-error input and context is required
      requiredUtils.queryOptions({})
      // @ts-expect-error input is required
      requiredUtils.queryOptions({ context: { batch: true } })
    })

    it('infer correct input type', () => {
      utils.queryOptions({ input: { cursor: 1 }, context: { batch: true } })
      // @ts-expect-error invalid input
      utils.queryOptions({ input: { cursor: 'invalid' }, context: { batch: true } })
    })

    it('infer correct context type', () => {
      utils.queryOptions({ context: { batch: true } })
      // @ts-expect-error invalid context
      utils.queryOptions({ context: { batch: 'invalid' } })
    })

    it('works with ref', () => {
      utils.queryOptions({
        input: computed(() => ({ cursor: 1 })),
        context: computed(() => ({ batch: true })),
      })

      utils.queryOptions({
        input: () => ({ cursor: 1 }),
        context: () => ({ batch: true }),
      })
    })

    describe('works with useQuery', () => {
      it('without initial data', () => {
        const query = useQuery(utils.queryOptions())

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput | undefined>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })

      it('with initial data', () => {
        const query = useQuery(utils.queryOptions({
          initialData: () => [{ title: 'title' }],
        }))

        expectTypeOf(query.data.value).toEqualTypeOf<UtilsOutput>()
        expectTypeOf(query.error.value).toEqualTypeOf<UtilsError | null>()
      })
    })
  })

  describe('.mutationOptions', () => {
    it('can optional options', () => {
      const requiredUtils = {} as Public<ProcedureUtils<{ batch: boolean }, 'input', UtilsOutput, Error>>

      utils.mutationOptions()
      utils.mutationOptions({})

      requiredUtils.mutationOptions({
        context: { batch: true },
      })
      // @ts-expect-error context is required
      requiredUtils.mutationOptions()
      // @ts-expect-error context is required
      requiredUtils.mutationOptions({})
    })

    it('infer correct context type', () => {
      utils.mutationOptions({ context: { batch: true } })
      // @ts-expect-error invalid context
      utils.mutationOptions({ context: { batch: 'invalid' } })
    })

    it('works with ref', () => {
      utils.mutationOptions({
        context: computed(() => ({ batch: true })),
      })

      utils.mutationOptions({
        context: () => ({ batch: true }),
      })
    })

    it('works with useMutation', () => {
      const mutation = useMutation(utils.mutationOptions({
        onSuccess: (data, input) => {
          expectTypeOf(data).toEqualTypeOf<UtilsOutput>()
          expectTypeOf(input).toEqualTypeOf<UtilsInput>()
        },
        onError: (error) => {
          expectTypeOf(error).toEqualTypeOf<UtilsError>()
        },
      }))

      expectTypeOf<Parameters<typeof mutation.mutate>[0]>().toEqualTypeOf<UtilsInput>()
      expectTypeOf(mutation.data.value).toEqualTypeOf<UtilsOutput | undefined>()
      expectTypeOf(mutation.error.value).toEqualTypeOf<UtilsError | null>()
    })

    it('infer correct mutation context type', () => {
      useMutation({
        ...utils.mutationOptions({
          onMutate: () => ({ mutationContext: true }),
          onError: (e, v, context) => {
            expectTypeOf(context.mutationContext).toEqualTypeOf<undefined | boolean>()
          },
        }),
        onSettled: (d, e, v, context) => {
          expectTypeOf(context.mutationContext).toEqualTypeOf<undefined | boolean>()
        },
      })
    })
  })
})

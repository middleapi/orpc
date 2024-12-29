import type { RouterClient } from '@orpc/server'
import type { router } from 'examples/server'
import { createORPCVueQueryUtils } from '@orpc/vue-query'

export const orpc = createORPCVueQueryUtils({} as RouterClient<typeof router /** or contract router */, unknown>)

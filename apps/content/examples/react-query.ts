import type { RouterClient } from '@orpc/server'
import type { router } from 'examples/server'
import { createORPCReactQueryUtils } from '@orpc/react-query'

export const orpc = createORPCReactQueryUtils({} as RouterClient<typeof router /** or contract router */, unknown>)

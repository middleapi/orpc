import type { RouterClient } from '@orpc/server'
import type { router } from 'examples/server'
import { createORPCReact } from '@orpc/react'

export const { orpc, ORPCContext } = createORPCReact<RouterClient<typeof router /** or contract router */, unknown>>()

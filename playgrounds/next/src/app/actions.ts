'use server'

import { createServerFunctionable } from '@orpc/next'
import * as z from 'zod'

import { publicOS } from '@/orpc'

import { messagePublisher } from '../context'

const actionable = createServerFunctionable({
  context: { messagePublisher },
})

export const ping = actionable(
  publicOS
    .input(
      z.object({
        name: z.string().min(6),
      }),
    )
    .output(z.string())
    .handler(async ({ input }) => {
      return `Hello ${input.name}!`
    }),
)

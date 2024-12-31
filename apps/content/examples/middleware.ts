import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'

// in oRPC middleware is so powerful

export type Context = { user?: { id: string } }

export const publicRoute = os
  .context<Context>()
  .use(async (input, context, meta) => {
    // This middleware will apply to everything create from pub
    const start = Date.now()

    try {
      return await meta.next({})
    }
    finally {
    // eslint-disable-next-line no-console
      console.log(`middleware cost ${Date.now() - start}ms`)
    }
  })

export const authMiddleware = publicRoute.middleware(async (input, context, meta) => {
  if (!context.user) {
    throw new ORPCError({ code: 'UNAUTHORIZED' })
  }

  const _path = meta.path // for analyze
  const _procedure = meta.procedure // for analyze

  const result = await meta.next({ context: { user: context.user } })
  const _output = result.output // for analyze
  return result
})

export const authed = publicRoute.use(authMiddleware) // any procedure compose from authOS will be protected

export const canEditPost = authMiddleware.concat(
  // Now you expect to have id in input
  async (input: { id: string }, context, meta) => {
    if (context.user.id !== input.id) {
      throw new ORPCError({ code: 'UNAUTHORIZED' })
    }

    return meta.next({})
  },
)

export const editPost = authed
  .input(z.object({ id: z.string() }))
  .output(z.string())
  .use(canEditPost) // if input not match, will throw type error
  .use(canEditPost, old => ({ id: old.id })) // Can map input if needed
  .use(async (input, context, meta) => {
    // If middleware create after .input and .output them will be typed

    const result = await meta.next({})
    const _output = result.output
    return result
  })
  .handler(() => 'Edited')

//
//

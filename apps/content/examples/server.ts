import type { InferRouterInputs, InferRouterOutputs } from '@orpc/server'
import { ORPCError, os } from '@orpc/server'
import { oz, ZodCoercer } from '@orpc/zod'
import { z } from 'zod'

export type Context = { user?: { id: string } } | undefined

// global publicProcedure, authProcedure completely optional
export const publicProcedure = os.context<Context>()
export const authProcedure = publicProcedure.use((input, context, meta) => {
  /** put auth logic here */
  return meta.next({})
})

export const router = publicProcedure.router({
  getUser: os
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .handler(async (input, context, meta) => {
      return {
        id: input.id,
        name: 'example',
      }
    }),

  posts: publicProcedure.prefix('/posts').router({
    getPost: publicProcedure
      .route({
        path: '/{id}', // custom your OpenAPI
        method: 'GET',
      })
      .input(
        z.object({
          id: z.string(),
        }),
      )
      .output(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
        }),
      )
      .use(async (input, context, meta) => {
        if (!context?.user) {
          throw new ORPCError({
            code: 'UNAUTHORIZED',
          })
        }

        const result = await meta.next({
          context: {
            user: context.user, // from now user not undefined-able
          },
        })

        const _output = result.output // do something on success

        return result
      })
      .handler((input, context, meta) => {
        return {
          id: 'example',
          title: 'example',
          description: 'example',
        }
      }),

    createPost: authProcedure
      .input(
        z.object({
          title: z.string(),
          description: z.string(),
          thumb: oz.file().type('image/*'),
        }),
      )
      .handler(async (input, context, meta) => {
        const _thumb = input.thumb // file upload out of the box

        return {
          id: 'example',
          title: input.title,
          description: input.description,
        }
      }),
  }),
})

export type Inputs = InferRouterInputs<typeof router>
export type Outputs = InferRouterOutputs<typeof router>

// Modern runtime that support fetch api like deno, bun, cloudflare workers, even node can used
import { createServer } from 'node:http'
// Expose apis to the internet with fetch handler
import { OpenAPIServerlessHandler } from '@orpc/openapi/fetch'
import { CompositeHandler, ORPCHandler } from '@orpc/server/fetch'
import { createServerAdapter } from '@whatwg-node/server'

const openapiHandler = new OpenAPIServerlessHandler(router, {
  schemaCoercers: [
    new ZodCoercer(),
  ],
})
const orpcHandler = new ORPCHandler(router)
const compositeHandler = new CompositeHandler([openapiHandler, orpcHandler])

const server = createServer(
  createServerAdapter((request: Request) => {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api')) {
      return compositeHandler.fetch(request, {
        prefix: '/api',
        context: {},
      })
    }

    return new Response('Not found', { status: 404 })
  }),
)

server.listen(3000, () => {
  // eslint-disable-next-line no-console
  console.log('Server is available at http://localhost:3000')
})

//
//

export default router

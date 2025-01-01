import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract'
import { oc } from '@orpc/contract'
import { ORPCError, os } from '@orpc/server'
import { oz, ZodCoercer } from '@orpc/zod'
import { z } from 'zod'

// Define your contract first
// This contract can replace server router in most-case

export const contract = oc.router({
  getUser: oc
    .route({
      path: '/{id}',
      method: 'GET',
    })
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .output(
      z.object({
        username: z.string(),
        avatar: z.string(),
      }),
    ),

  posts: oc.prefix('/posts').router({
    getPost: oc
      .route({
        path: '/{id}',
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
      ),

    createPost: oc
      .input(
        z.object({
          title: z.string(),
          description: z.string(),
          thumb: oz.file().type('image/*'),
        }),
      )
      .output(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
        }),
      ),
  }),
})

export type Inputs = InferContractRouterInputs<typeof contract>
export type Outputs = InferContractRouterOutputs<typeof contract>

// Implement the contract

export type Context = { user?: { id: string } }
export const base = os.context<Context>()
export const pub = base.contract(contract) // Ensure every implement must be match contract
export const authed = base
  .use((input, context, meta) => {
    /** put auth logic here */
    return meta.next({})
  })
  .contract(contract)

export const router = pub.router({
  getUser: pub.getUser.handler((input, context, meta) => {
    return {
      username: `user_${input.id}`,
      avatar: `avatar_${input.id}.png`,
    }
  }),

  posts: {
    getPost: pub.posts.getPost
      .use(async (input, context, meta) => {
        if (!context.user) {
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

    createPost: authed.posts.createPost.handler((input, context, meta) => {
      return {
        id: 'example',
        title: input.title,
        description: input.description,
      }
    }),
  },
})

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
        context: {},
        prefix: '/api',
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

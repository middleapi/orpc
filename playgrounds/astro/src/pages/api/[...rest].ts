import '../../polyfill'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { onError } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'
import { router } from '../../routers'
import type { APIRoute } from 'astro'
import { NewUserSchema, UserSchema } from '../../schemas/user'
import { CredentialSchema, TokenSchema } from '../../schemas/auth'
import { NewPlanetSchema, PlanetSchema, UpdatePlanetSchema } from '../../schemas/planet'

const handler = new OpenAPIHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
  plugins: [
    new SmartCoercionPlugin({
      schemaConverters: [
        new ZodToJsonSchemaConverter(),
      ],
    }),
    new OpenAPIReferencePlugin({
      schemaConverters: [
        new ZodToJsonSchemaConverter(),
      ],
      specGenerateOptions: {
        info: {
          title: 'ORPC Playground',
          version: '1.0.0',
        },
        commonSchemas: {
          NewUser: { schema: NewUserSchema },
          User: { schema: UserSchema },
          Credential: { schema: CredentialSchema },
          Token: { schema: TokenSchema },
          NewPlanet: { schema: NewPlanetSchema },
          UpdatePlanet: { schema: UpdatePlanetSchema },
          Planet: { schema: PlanetSchema },
          UndefinedError: { error: 'UndefinedError' },
        },
        security: [{ bearerAuth: [] }],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
            },
          },
        },
      },
      docsConfig: {
        authentication: {
          securitySchemes: {
            bearerAuth: {
              token: 'default-token',
            },
          },
        },
      },
    }),
  ],
})

export const prerender = false

export const ALL: APIRoute = async ({ request }) => {
  const { response } = await handler.handle(request, {
    prefix: '/api',
    context: {
      session: { user: { id: 'unique', name: 'unnoq', email: 'contact@unnoq.com' } },
    },
  })

  return response ?? new Response('Not found', { status: 404 })
}

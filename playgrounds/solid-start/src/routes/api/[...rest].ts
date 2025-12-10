import type { APIEvent } from '@solidjs/start/server'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { router } from '~/routers'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { onError } from '@orpc/server'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'
import '~/polyfill'
import { NewUserSchema, UserSchema } from '~/schemas/user'
import { CredentialSchema, TokenSchema } from '~/schemas/auth'
import { NewPlanetSchema, PlanetSchema, UpdatePlanetSchema } from '~/schemas/planet'

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

async function handle({ request }: APIEvent) {
  const context = request.headers.get('Authorization')
    ? { user: { id: 'test', name: 'John Doe', email: 'john@doe.com' } }
    : {}

  const { response } = await handler.handle(request, {
    prefix: '/api',
    context,
  })

  return response ?? new Response('Not Found', { status: 404 })
}

export const HEAD = handle
export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle

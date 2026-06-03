import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { onError } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { router } from '../../routers'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'
import { UserSchema } from '../../schemas/user'
import { NewPlanetSchema, PlanetSchema, UpdatePlanetSchema } from '#shared/apps/lunaria/schemas/planet'
import { getUserFromRequest } from '../../auth-context'
import { getPublicAuthOpenAPI } from '../../openapi/auth'

const openAPIHandler = new OpenAPIHandler(router, {
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
      async specGenerateOptions() {
        const authOpenAPI = await getPublicAuthOpenAPI()

        return {
          info: {
            title: 'Workspace API',
            version: '1.0.0',
          },
          tags: [{
            name: 'Auth',
            description: 'Shared authentication and session endpoints used by every application.',
          }, {
            name: 'Platform',
            description: 'Shared workspace endpoints that are not owned by a single application.',
          }, {
            name: 'Lunaria',
            description: 'Lunaria application endpoints for planets and streams.',
          }, {
            name: 'Market trends',
            description: 'Market trends application endpoints for index snapshots and refreshes.',
          }],
          'x-tagGroups': [{
            name: 'Shared system',
            tags: ['Auth', 'Platform'],
          }, {
            name: 'Applications',
            tags: ['Lunaria', 'Market trends'],
          }],
          commonSchemas: {
            User: { schema: UserSchema },
            NewPlanet: { schema: NewPlanetSchema },
            UpdatePlanet: { schema: UpdatePlanetSchema },
            Planet: { schema: PlanetSchema },
            UndefinedError: { error: 'UndefinedError' },
          },
          security: [{ bearerAuth: [] }],
          paths: authOpenAPI.paths,
          components: {
            schemas: authOpenAPI.components.schemas,
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
              },
              ...authOpenAPI.components.securitySchemes,
            },
          },
        }
      },
      docsConfig: {
        authentication: {
          securitySchemes: {
            bearerAuth: {
              token: 'default-token',
            },
            betterAuthCookie: {
              value: 'better-auth.session_token=...',
            },
          },
        },
      },
    }),
  ],
})

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event)

  const user = await getUserFromRequest(request.headers)

  const { response } = await openAPIHandler.handle(request, {
    prefix: '/api',
    context: {
      headers: request.headers,
      ...(user ? { user } : {}),
    },
  })

  if (response) {
    return response
  }

  setResponseStatus(event, 404, 'Not Found')
  return 'Not Found'
})

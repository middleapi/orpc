import { createServer } from 'node:http'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/node'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { router } from './routers'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'
import './polyfill'
import { NewUserSchema, UserSchema } from './schemas/user'
import { CredentialSchema, TokenSchema } from './schemas/auth'
import { NewPlanetSchema, PlanetSchema, UpdatePlanetSchema } from './schemas/planet'

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

const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error)
    }),
  ],
})

const server = createServer(async (req, res) => {
  const context = req.headers.authorization
    ? { user: { id: 'test', name: 'John Doe', email: 'john@doe.com' } }
    : {}

  const api = await openAPIHandler.handle(req, res, {
    prefix: '/api',
    context,
  })

  if (api.matched) {
    return
  }

  const rpc = await rpcHandler.handle(req, res, {
    prefix: '/rpc',
    context,
  })

  if (rpc.matched) {
    return
  }

  res.statusCode = 404
  res.end('Not found')
})

server.listen(3000, () => {
  console.log('Playground is available at http://localhost:3000/api')
})

import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { contract } from 'src/contract'
import { CredentialSchema, TokenSchema } from 'src/schemas/auth'
import { NewPlanetSchema, PlanetSchema, UpdatePlanetSchema } from 'src/schemas/planet'
import { NewUserSchema, UserSchema } from 'src/schemas/user'

export class ReferenceService {
  private readonly openapiGenerator = new OpenAPIGenerator({
    schemaConverters: [
      new ZodToJsonSchemaConverter(),
    ],
  })

  spec() {
    return this.openapiGenerator.generate(contract, {
      info: {
        title: 'ORPC Playground',
        version: '1.0.0',
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
      servers: [
        { url: 'http://localhost:3000' },
      ],
    })
  }
}

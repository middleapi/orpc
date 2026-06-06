import { JSON_SCHEMA_REGISTRY } from '@orpc/zod/zod4'
import { UserSchema } from '#shared/schemas/user'

export type { User } from '#shared/schemas/user'
export { UserSchema } from '#shared/schemas/user'

JSON_SCHEMA_REGISTRY.add(UserSchema, {
  examples: [
    {
      id: '1',
      name: 'John Doe',
      email: 'john@doe.com'
    }
  ]
})

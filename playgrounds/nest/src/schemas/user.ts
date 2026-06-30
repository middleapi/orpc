import { JSON_SCHEMA_REGISTRY } from '@orpc/zod/zod4'
import * as z from 'zod'

export type NewUser = z.infer<typeof NewUserSchema>
export type User = z.infer<typeof UserSchema>

export const NewUserSchema = z.object({
  name: z.string(),
  email: z.email(),
  password: z.string(),
})

JSON_SCHEMA_REGISTRY.add(NewUserSchema, {
  examples: [
    {
      name: 'John Doe',
      email: 'john@doe.com',
      password: '123456',
    },
  ],
})

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
})

JSON_SCHEMA_REGISTRY.add(UserSchema, {
  examples: [
    {
      id: '1',
      name: 'John Doe',
      email: 'john@doe.com',
    },
  ],
})

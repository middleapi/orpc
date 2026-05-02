import { authed, pub } from '../orpc'
import { CredentialSchema, TokenSchema } from '../schemas/auth'
import { NewUserSchema, UserSchema } from '../schemas/user'

export const signup = pub
  .route({
    method: 'POST',
    path: '/auth/signup',
    summary: 'Sign up a new user',
    tags: ['Authentication'],
  })
  .input(NewUserSchema)
  .output(UserSchema)
  .handler(async ({ input, context }) => {
    return {
      id: '28aa6286-48e9-4f23-adea-3486c86acd55',
      email: input.email,
      name: input.name,
    }
  })

export const signin = pub
  .route({
    method: 'POST',
    path: '/auth/signin',
    summary: 'Sign in a user',
    tags: ['Authentication'],
  })
  .input(CredentialSchema)
  .output(TokenSchema)
  .handler(async ({ input, context }) => {
    return { token: 'token' }
  })

export const me = authed
  .route({
    method: 'GET',
    path: '/auth/me',
    summary: 'Get the current user',
    tags: ['Authentication'],
  })
  .output(UserSchema)
  .handler(async ({ input, context }) => {
    return {
      ...context.user,
      id: '28aa6286-48e9-4f23-adea-3486c86acd56',
    }
  })

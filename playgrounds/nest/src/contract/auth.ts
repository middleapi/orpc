import { oc } from '@orpc/contract'
import { CredentialSchema, TokenSchema } from '../schemas/auth'
import { NewUserSchema, UserSchema } from '../schemas/user'

export const signup = oc
  .route({
    method: 'POST',
    path: '/auth/signup',
    summary: 'Sign up a new user',
    tags: ['Authentication'],
  })
  .input(NewUserSchema)
  .output(UserSchema)

export const signin = oc
  .route({
    method: 'POST',
    path: '/auth/signin',
    summary: 'Sign in a user',
    tags: ['Authentication'],
  })
  .input(CredentialSchema)
  .output(TokenSchema)

export const me = oc
  .route({
    method: 'GET',
    path: '/auth/me',
    summary: 'Get the current user',
    tags: ['Authentication'],
  })
  .output(UserSchema)

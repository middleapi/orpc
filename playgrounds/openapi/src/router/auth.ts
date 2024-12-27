import { authed, pub } from '../orpc'
import { CredentialSchema, TokenSchema } from '../schemas/auth'
import { NewUserSchema, UserSchema } from '../schemas/user'

export const signup = pub
  .route({
    method: 'POST',
    path: '/signup',
    summary: 'Sign up a new user',
  })
  .input(NewUserSchema)
  .output(UserSchema)
  .handler(async (input, context, meta) => {
    return {
      id: '28aa6286-48e9-4f23-adea-3486c86acd55',
      email: input.email,
      name: input.name,
    }
  })

export const signin = pub
  .route({
    method: 'POST',
    path: '/signin',
    summary: 'Sign in a user',
  })
  .input(CredentialSchema)
  .output(TokenSchema)
  .handler(async (input, context, meta) => {
    return {
      token: 'token',
    }
  })

export const refresh = authed
  .route({
    method: 'POST',
    path: '/refresh',
    summary: 'Refresh a token',
  })
  .output(TokenSchema)
  .handler(async (input, context, meta) => {
    return {
      token: 'new-token',
    }
  })

export const revoke = authed
  .route({
    method: 'DELETE',
    path: '/revoke',
    summary: 'Revoke a token',
  })
  .input(TokenSchema)
  .handler(async (input, context, meta) => {
    // Do something
  })

export const me = authed
  .route({
    method: 'GET',
    path: '/me',
    summary: 'Get the current user',
  })
  .output(UserSchema)
  .handler(async (input, context, meta) => {
    return context.user
  })

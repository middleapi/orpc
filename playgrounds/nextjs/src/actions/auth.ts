'use server'

import { authed, pub } from '../orpc'
import { CredentialSchema, TokenSchema } from '../schemas/auth'
import { NewUserSchema, UserSchema } from '../schemas/user'

export const signup = pub
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
  .input(CredentialSchema)
  .output(TokenSchema)
  .handler(async (input, context, meta) => {
    return {
      token: 'token',
    }
  })

export const refresh = authed
  .output(TokenSchema)
  .handler(async (input, context, meta) => {
    return {
      token: 'new-token',
    }
  })

export const revoke = authed
  .input(TokenSchema)
  .handler(async (input, context, meta) => {
    // Do something
  })

export const me = authed
  .output(UserSchema)
  .handler(async (input, context, meta) => {
    return context.user
  })

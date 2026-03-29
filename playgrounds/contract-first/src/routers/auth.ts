import { authed, pub } from '../orpc'

export const signup = pub.auth.signup
  .handler(async ({ input, context }) => {
    return {
      id: '28aa6286-48e9-4f23-adea-3486c86acd55',
      email: input.email,
      name: input.name,
    }
  })

export const signin = pub.auth.signin
  .handler(async ({ input, context }) => {
    return { token: 'token' }
  })

export const me = authed.auth.me
  .handler(async ({ context }) => {
    return context.user
  })

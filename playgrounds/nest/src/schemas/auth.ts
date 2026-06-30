import * as z from 'zod'

export const CredentialSchema = z.object({
  email: z.email(),
  password: z.string(),
})

export const TokenSchema = z.object({
  token: z.string(),
})

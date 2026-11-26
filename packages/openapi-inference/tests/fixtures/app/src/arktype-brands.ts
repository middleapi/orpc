import { os, type as orpcType } from '@orpc/server'
import { type } from 'arktype'

/** An ArkType brand of an object, a key only its type has */
export const BrandedUser = type({ id: 'string', joinedAt: 'Date' }).brand('User')

export type BrandedUser = typeof BrandedUser.infer

export const arktypeBrands = {
  brandedUser: os.handler((): BrandedUser =>
    BrandedUser.assert({ id: 'u', joinedAt: new Date(0) }),
  ),
  brandedUsers: os.handler(
    (): { byId: Record<string, BrandedUser>; list: readonly BrandedUser[] } => {
      const user = BrandedUser.assert({ id: 'u', joinedAt: new Date(0) })
      return { byId: { u: user }, list: [user] }
    },
  ),
  readonlyBrandedUser: os.handler((): Readonly<BrandedUser> =>
    BrandedUser.assert({ id: 'u', joinedAt: new Date(0) }),
  ),
  brandedUserInput: os.input(orpcType<BrandedUser>()).handler(() => 1),
}

import { os, type } from '@orpc/server'
import { Brand, Redacted, Schema } from 'effect'

/** An Effect brand of an object, a key only its type has */
export const BrandedAccount = Schema.Struct({ id: Schema.String }).pipe(Schema.brand('Account'))

export type BrandedAccount = typeof BrandedAccount.Type

export type BrandedOwner = { readonly handle: string } & Brand.Brand<'Owner'>

export const BrandedOwner: Brand.Constructor<BrandedOwner> = Brand.nominal<BrandedOwner>()

export const roundSeventyFive = {
  brandedAccount: os.handler((): { account: BrandedAccount; owners: readonly BrandedOwner[] } => ({
    account: BrandedAccount.make({ id: 'a' }),
    owners: [BrandedOwner({ handle: 'o' })],
  })),
  brandedOwner: os.handler((): BrandedOwner => BrandedOwner({ handle: 'o' })),
  brandedOwnerInput: os.input(type<BrandedOwner>()).handler(() => 1),
  // a `Redacted` is written by the `toJSON` of its prototype, which its interface does not declare
  redacted: os.handler((): { secret: Redacted.Redacted } => ({
    secret: Redacted.make('s', { label: 'token' }),
  })),
  redactedRoot: os.handler((): Redacted.Redacted => Redacted.make('s')),
  redactedInput: os.input(type<{ secret: Redacted.Redacted }>()).handler(() => 1),
}

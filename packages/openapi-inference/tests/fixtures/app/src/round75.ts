import { os, type } from '@orpc/server'
import { Brand, Equal, Hash, Option, Redacted, Schema } from 'effect'
import type { PartialDeep } from 'type-fest'

/** An Effect brand of an object, a key only its type has */
export const BrandedAccount = Schema.Struct({ id: Schema.String }).pipe(Schema.brand('Account'))

export type BrandedAccount = typeof BrandedAccount.Type

export type BrandedOwner = { readonly handle: string } & Brand.Brand<'Owner'>

export const BrandedOwner: Brand.Constructor<BrandedOwner> = Brand.nominal<BrandedOwner>()

// a plain object implementing Effect's `Hash`: the method is a function, not data
export interface HashedRecord extends Hash.Hash {
  readonly recordKey: string
}

export const hashedRecord = (): HashedRecord => ({ recordKey: 'x', [Hash.symbol]: () => 1 })

export type ComparedAmount = { readonly comparedCents: number } & Equal.Equal

export const comparedAmount = (): ComparedAmount => ({
  comparedCents: 1,
  [Equal.symbol]: () => false,
  [Hash.symbol]: () => 1,
})

export interface SecretConfig {
  key: Redacted.Redacted
  opt: Option.Option<number>
  n: number
}

export const secretConfig = (): SecretConfig => ({
  key: Redacted.make('s'),
  opt: Option.some(1),
  n: 1,
})

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
  hashedRecord: os.handler((): HashedRecord => hashedRecord()),
  hashedRecordInput: os.input(type<HashedRecord>()).handler(() => 1),
  partialHashedRecord: os.handler((): Partial<HashedRecord> => hashedRecord()),
  comparedAmount: os.handler((): ComparedAmount => comparedAmount()),
  comparedAmountInput: os.input(type<ComparedAmount>()).handler(() => 1),
  // the type id of a partial view is optional, its values are still made from the prototype
  partialRedacted: os.handler((): { r: Partial<Redacted.Redacted> } => ({
    r: Redacted.make('s'),
  })),
  partialRedactedInput: os.input(type<{ r: Partial<Redacted.Redacted> }>()).handler(() => 1),
  partialDeepConfig: os.handler((): PartialDeep<SecretConfig> => secretConfig()),
  partialDeepConfigInput: os.input(type<PartialDeep<SecretConfig>>()).handler(() => 1),
}

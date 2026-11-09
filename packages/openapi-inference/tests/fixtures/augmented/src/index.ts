import type { Animal, Branded, Frozen, Generic, Opaque, Reporter, Session } from 'augments-error'

export class AppError extends Error {
  code = 'APP'
}

/** Errors of a project where a package augments the global `Error` */
export interface Errors {
  app: AppError
  type: TypeError
  plain: Error
  reporter?: Reporter
}

declare function model<T>(name: string, shape?: T): { new (): T & { save(): void } }

/** A project interface with a model factory describes plain objects */
export interface User {
  roles: Set<string>
}

export const User = model<User>('User')

declare global {
  interface BigInt {
    toJSON(): string
  }

  interface Map<K, V> {
    toJSON(): [K, V][]
  }

  interface TypeError {
    code?: string
  }
}

export class WithPolyfills {
  big = 1n
  counts = new Map<string, number>()
}

/** Values of interfaces with constructors */
export interface Constructed {
  opaque: Opaque
  session: Session
  user: User
}

/** Library classes, also augmented by the project or created through other types */
export interface LibraryClasses {
  typeError: TypeError
  branded: Branded
  frozen: Frozen
  generic: Generic
  animal: Animal
}

export interface MaybeJSON {
  a: number
  toJSON?(): string
}

export class Account {
  id = '1'
  password = 'secret'

  toJSON(): Omit<Account, 'password' | 'toJSON'> {
    return { id: this.id }
  }
}

/** `toJSON` that may be missing, and `toJSON` returning a library alias */
export interface ToJSONCases {
  maybe: MaybeJSON
  account: Account
}

/** A bigint, and a boxed one, which the serializer leaves to `JSON.stringify` */
export interface BoxedBigInts {
  n: bigint
  // oxlint-disable-next-line typescript/no-wrapper-object-types
  boxed: BigInt
}

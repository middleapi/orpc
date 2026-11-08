import type { Opaque, Reporter, Session } from 'augments-error'

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

export type MaybeOptionalOptions<TOptions> = {} extends TOptions
  ? [options?: TOptions]
  : [options: TOptions]

export function resolveMaybeOptionalOptions<T>(rest: [options?: T]): T {
  return rest[0] ?? ({} as T) // 0 only undefined when all fields are optional
}

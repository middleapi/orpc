import type { PartialDeep, ReadonlyDeep, Simplify } from 'type-fest'

export interface Circle {
  kind: 'circle'
  radius: number
}

export interface Rect {
  kind: 'rect'
  width: number
  height: number
}

export type Shape = Circle | Rect

export interface Category {
  name: string
  children: Category[]
}

export interface Page<TItem> {
  items: TItem[]
  next: string | null
}

export type EventName = `on${Capitalize<'click' | 'hover'>}`

export type Slug = `user-${number}`

export type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: T[K] }

export type Unwrapped<T> = T extends Promise<infer TValue> ? TValue : T

export interface Settings {
  theme: { color: string; dark: boolean }
  limits: { daily: number }
}

export type SettingsPatch = PartialDeep<Settings>

export type FrozenSettings = ReadonlyDeep<Settings>

export type Flat = Simplify<{ a: string } & { b: number }>

export type VersionGetters = Getters<{ version: number; label: string }>

export interface Showcase {
  shapes: Shape[]
  tree: Category
  page: Page<Shape>
  event: EventName
  slug: Slug
  patch: SettingsPatch
  frozen: FrozenSettings
  flat: Flat
  getters: VersionGetters
  unwrapped: Unwrapped<Promise<number>>
}

export class Money {
  constructor(
    public amount: number,
    public currency: string,
  ) {}

  toJSON(): string {
    return `${this.amount} ${this.currency}`
  }
}

export class Account {
  constructor(
    public owner: string,
    public balance: Money,
    public opened: Date,
  ) {}
}

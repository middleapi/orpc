/** status doc */
export type Status = 'open' | 'closed' | null
export interface Extended {
  status?: Status | 'archived'
  count?: Status | number
  plain?: Status
}

export type Maybe<T> = T | null
export interface WithMaybe {
  name?: Maybe<string>
  count?: Maybe<number>
}
export type Nullable<T> = T | null
export interface Generic<T> {
  item?: Nullable<T>
}
export type GenericUser = Generic<{ id: string }>

export interface FlagSource {
  status: Status
  title: string
}
export type Flags<T> = { [K in keyof T]?: boolean | null }
export type SourceFlags = Flags<FlagSource>

/** A nullable flag */
export type Flag = boolean | null
export interface Unrelated {
  enabled: boolean | null
  other?: boolean | null
}
export interface UsesFlag {
  f: Flag
}

type Next = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
export type Counter<N extends number> = N extends 10
  ? 'end'
  : { a: Counter<Next[N]>; b: Counter<Next[N]>; c: Counter<Next[N]>[] }
export type Counted = Counter<0>

export interface Entity0 {
  id: string
  value0: number
}
export interface Entity1 {
  id: string
  value1: number
}
export interface Entity2 {
  id: string
  value2: number
}
export interface Entity3 {
  id: string
  value3: number
}
export interface Entity4 {
  id: string
  value4: number
}
export interface Entity5 {
  id: string
  value5: number
}
export interface Entity6 {
  id: string
  value6: number
}
export interface Entity7 {
  id: string
  value7: number
}
export interface Entity8 {
  id: string
  value8: number
}
export interface Entity9 {
  id: string
  value9: number
}
export interface Entity10 {
  id: string
  value10: number
}
export interface Entity11 {
  id: string
  value11: number
}
export interface Entity12 {
  id: string
  value12: number
}
export interface Entity13 {
  id: string
  value13: number
}
export interface Entity14 {
  id: string
  value14: number
}
export interface Entity15 {
  id: string
  value15: number
}
export interface Entity16 {
  id: string
  value16: number
}
export interface Entity17 {
  id: string
  value17: number
}
export interface Entity18 {
  id: string
  value18: number
}
export interface Entity19 {
  id: string
  value19: number
}
export interface Entity20 {
  id: string
  value20: number
}
export interface Entity21 {
  id: string
  value21: number
}
export interface Entity22 {
  id: string
  value22: number
}
export interface Entity23 {
  id: string
  value23: number
}
export interface Entity24 {
  id: string
  value24: number
}
export interface Entity25 {
  id: string
  value25: number
}
export interface Entity26 {
  id: string
  value26: number
}
export interface Entity27 {
  id: string
  value27: number
}
export interface Entity28 {
  id: string
  value28: number
}
export interface Entity29 {
  id: string
  value29: number
}
export interface Entity30 {
  id: string
  value30: number
}
export interface Entity31 {
  id: string
  value31: number
}
export interface Entity32 {
  id: string
  value32: number
}
export interface Entity33 {
  id: string
  value33: number
}
export interface Entity34 {
  id: string
  value34: number
}
export interface Entity35 {
  id: string
  value35: number
}
export interface Entity36 {
  id: string
  value36: number
}
export interface Entity37 {
  id: string
  value37: number
}
export interface Entity38 {
  id: string
  value38: number
}
export interface Entity39 {
  id: string
  value39: number
}
export interface Entity40 {
  id: string
  value40: number
}
export interface Entity41 {
  id: string
  value41: number
}
export interface Entity42 {
  id: string
  value42: number
}
export interface Entity43 {
  id: string
  value43: number
}
export interface Entity44 {
  id: string
  value44: number
}
export interface Entity45 {
  id: string
  value45: number
}
export interface Entity46 {
  id: string
  value46: number
}
export interface Entity47 {
  id: string
  value47: number
}
export interface Entity48 {
  id: string
  value48: number
}
export interface Entity49 {
  id: string
  value49: number
}
export interface Entity50 {
  id: string
  value50: number
}
export interface Entity51 {
  id: string
  value51: number
}
export interface Entity52 {
  id: string
  value52: number
}
export interface Entity53 {
  id: string
  value53: number
}
export interface Entity54 {
  id: string
  value54: number
}
export interface Entity55 {
  id: string
  value55: number
}
export interface Entity56 {
  id: string
  value56: number
}
export interface Entity57 {
  id: string
  value57: number
}
export interface Entity58 {
  id: string
  value58: number
}
export interface Entity59 {
  id: string
  value59: number
}
export interface Entity60 {
  id: string
  value60: number
}
export interface Entity61 {
  id: string
  value61: number
}
export interface Entity62 {
  id: string
  value62: number
}
export interface Entity63 {
  id: string
  value63: number
}
export interface Entity64 {
  id: string
  value64: number
}
export interface Entity65 {
  id: string
  value65: number
}
export interface Entity66 {
  id: string
  value66: number
}
export interface Entity67 {
  id: string
  value67: number
}
export interface Entity68 {
  id: string
  value68: number
}
export interface Entity69 {
  id: string
  value69: number
}
export interface WideRoot {
  e0: Entity0
  e1: Entity1
  e2: Entity2
  e3: Entity3
  e4: Entity4
  e5: Entity5
  e6: Entity6
  e7: Entity7
  e8: Entity8
  e9: Entity9
  e10: Entity10
  e11: Entity11
  e12: Entity12
  e13: Entity13
  e14: Entity14
  e15: Entity15
  e16: Entity16
  e17: Entity17
  e18: Entity18
  e19: Entity19
  e20: Entity20
  e21: Entity21
  e22: Entity22
  e23: Entity23
  e24: Entity24
  e25: Entity25
  e26: Entity26
  e27: Entity27
  e28: Entity28
  e29: Entity29
  e30: Entity30
  e31: Entity31
  e32: Entity32
  e33: Entity33
  e34: Entity34
  e35: Entity35
  e36: Entity36
  e37: Entity37
  e38: Entity38
  e39: Entity39
  e40: Entity40
  e41: Entity41
  e42: Entity42
  e43: Entity43
  e44: Entity44
  e45: Entity45
  e46: Entity46
  e47: Entity47
  e48: Entity48
  e49: Entity49
  e50: Entity50
  e51: Entity51
  e52: Entity52
  e53: Entity53
  e54: Entity54
  e55: Entity55
  e56: Entity56
  e57: Entity57
  e58: Entity58
  e59: Entity59
  e60: Entity60
  e61: Entity61
  e62: Entity62
  e63: Entity63
  e64: Entity64
  e65: Entity65
  e66: Entity66
  e67: Entity67
  e68: Entity68
  e69: Entity69
}
export type DeepPartial<T> = { [K in keyof T]?: DeepPartial<T[K]> }
export type WidePartial = DeepPartial<WideRoot>

export type ConditionalDeepPartial<T> = T extends object
  ? { [K in keyof T]?: ConditionalDeepPartial<T[K]> }
  : T
export type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> }
export interface Post {
  id: string
  createdAt: Date
  tags: Set<string>
  link: URL
  counts: Map<string, number>
}
export type ReadonlyPost = DeepReadonly<Post>
export type PartialPost = ConditionalDeepPartial<Post>

export interface Message {
  text: string
}
export interface ChatEvent<T extends string, D> {
  type: T
  data: D
}
export type AnyChatEvent = ChatEvent<'message', Message> | ChatEvent<'ping', null>

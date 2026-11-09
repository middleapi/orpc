import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import type { TypeQueries } from './type-queries'

/**
 * The def name of a named type: its symbol's name, or for an instantiated generic its printed
 * type (`Page<User>` -> `Page_User`).
 */
export function getDefName(types: TypeQueries, type: Type, symbol: TSSymbol): string {
  const symbolName = getSymbolName(symbol)
  // internal names like `__class` (class expressions) are not used
  const internal = symbolName.startsWith('__')

  if (!internal && (symbol.flags & SymbolFlags.Enum || !types.getTypeArguments(type).length)) {
    return symbolName
  }

  return (
    toDefName(printType(types, type)) ?? (internal ? getFallbackDefName(types, type) : symbolName)
  )
}

/**
 * The def name of a type without a usable name, like a recursive anonymous type.
 */
export function getFallbackDefName(types: TypeQueries, type: Type): string {
  const symbol = type.getAliasSymbol() ?? type.getSymbol()
  const name = symbol && getSymbolName(symbol)

  // not the name of a library wrapper, like `Array` of an anonymous recursive item
  if (
    name &&
    /^[\w$]+$/u.test(name) &&
    !name.startsWith('__') &&
    types.getSymbolSourceKind(symbol) !== 'default'
  ) {
    return name
  }

  const printed = toDefName(printType(types, type))
  return printed && printed !== name ? printed : 'Recursive'
}

/**
 * The def name of a view of a class, like `Readonly_User` for `Readonly<User>`, or `User_View`
 * when the printed type is not usable (`Pick<User, 'id' | 'name'>`).
 */
export function getViewDefName(types: TypeQueries, type: Type, classSymbol: TSSymbol): string {
  // joined with `-`, which no declared type name has, so a view never takes one
  return (
    toDefName(printType(types, type))?.replace(/_/gu, '-') ?? `${getSymbolName(classSymbol)}-View`
  )
}

/**
 * The printed type, or nothing for an object literal type without an alias (an anonymous mapped
 * type a conditional type resolves to), printed as `{ ... }`, which names no def.
 */
function printType(types: TypeQueries, type: Type): string {
  if (
    type.flags & TypeFlags.Object &&
    (type as any).objectFlags & (ObjectFlags.Anonymous | ObjectFlags.Mapped) &&
    !type.getAliasSymbol()
  ) {
    return '{}'
  }

  return types.memo('printed', type.id, () => types.checker.typeToString(type))
}

/**
 * The declared name of a symbol, also for default exports (`export default class Account`).
 */
function getSymbolName(symbol: TSSymbol): string {
  if (symbol.name !== 'default') {
    return symbol.name
  }

  const node = symbol.declarations[0]?.resolve() as any
  return typeof node?.name?.text === 'string' ? node.name.text : symbol.name
}

/**
 * A def name from a printed type: `Page<User>` -> `Page_User`, `Page<User[]>` -> `Page_UserArray`,
 * `Event<"message", Message>` -> `Event_message_Message`, `Pair<[A, B]>` -> `Pair_A_B`.
 * Types with object literals, functions, unions, or intersections in their arguments are not named this way.
 */
function toDefName(text: string): string | undefined {
  if (text.length > 80 || /[{}()|&]|=>|\.\.\./u.test(text) || !/^[\w$.]+(?:<.*>)?$/u.test(text)) {
    return undefined
  }

  return (
    text
      .replace(/\[\]/gu, 'Array')
      .replace(/-(?=\d)/gu, 'neg')
      .replace(/[^\w$.]+/gu, '_')
      .replace(/^_+|_+$/gu, '') || undefined
  )
}

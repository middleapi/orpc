import type { Symbol as TSSymbol, Type } from 'typescript/unstable/sync'
import { ObjectFlags, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import type { PropertyAnnotation, TypeQueries } from './type-queries'

/**
 * The def name of a named type: its symbol's name, or for an instantiated generic its printed
 * type (`Page<User>` -> `Page_User`), with the keys of object literal arguments
 * (`Page<{ id: number; title: string }>` -> `Page_with-id-title`).
 */
export function getDefName(types: TypeQueries, type: Type, symbol: TSSymbol): string {
  const symbolName = getSymbolName(symbol)
  // internal names like `__class` (class expressions) are not used
  const internal = symbolName.startsWith('__')

  const written = getWrittenTypeArguments(types, type, symbol)

  if (!internal && (symbol.flags & SymbolFlags.Enum || !written.length)) {
    return symbolName
  }

  return (
    toDefName(printWritten(types, type, written)) ??
    toDefName(printWritten(types, type, written, true)) ??
    (internal ? getFallbackDefName(types, type) : symbolName)
  )
}

/**
 * The type arguments of an instantiated generic but the trailing ones left to their defaults
 * (`FindArgs<Defaults>` of `FindArgs<Ext = Defaults>` is written `FindArgs`).
 */
function getWrittenTypeArguments(
  types: TypeQueries,
  type: Type,
  symbol: TSSymbol,
): readonly Type[] {
  const args = types.getTypeArguments(type)
  const defaults = types.memo('typeParameterDefaults', symbol.id, () => {
    const node = symbol.declarations[0]?.resolve() as any
    return ((node?.typeParameters ?? []) as any[]).map((parameter) =>
      parameter.defaultType
        ? types.checker.getTypeFromTypeNode(parameter.defaultType)?.id
        : undefined,
    )
  })

  let count = args.length
  while (
    count > 0 &&
    defaults[count - 1] !== undefined &&
    defaults[count - 1] === args[count - 1]!.id
  ) {
    count--
  }

  return count === args.length ? args : args.slice(0, count)
}

/**
 * The printed type, with only the type arguments written (see `getWrittenTypeArguments`), also of
 * the generics in its arguments (`Box<Box<string>>` of `Box<T = string>` is written `Box<Box>`),
 * and with `keys`, object literal arguments printed by their first keys, also as array items
 * (`Result<{ id: number }[]>` is written `Result<with-id[]>`, see `printKeys`).
 */
function printWritten(
  types: TypeQueries,
  type: Type,
  written: readonly Type[],
  keys = false,
  depth = 0,
): string {
  const printed = printType(types, type)
  const args = written.map((t) => printArgument(types, t, keys, depth))

  if (
    args.length === types.getTypeArguments(type).length &&
    args.every((arg, i) => arg === printType(types, written[i]!))
  ) {
    return printed
  }

  const index = printed.indexOf('<')
  const head = index < 0 ? printed : printed.slice(0, index)
  return args.length ? `${head}<${args.join(', ')}>` : head
}

/** How deep the type arguments of the generics in type arguments are written */
const WRITTEN_ARGUMENTS_DEPTH = 4

/**
 * A type argument as `printWritten` writes it.
 */
function printArgument(types: TypeQueries, type: Type, keys: boolean, depth: number): string {
  const printed = printType(types, type)

  if (printed === '{}') {
    return (keys && printKeys(types, type)) || printed
  }

  if (depth >= WRITTEN_ARGUMENTS_DEPTH) {
    return printed
  }

  if (types.getReferenceKind(type) === 'array') {
    const element = types.getReferenceArguments(type)[0]
    const item = element && printArgument(types, element, keys, depth + 1)
    // not a union or an intersection, which would need parentheses
    return item === undefined || item === printType(types, element!) || /[|&]/u.test(item)
      ? printed
      : `${printed.startsWith('readonly ') ? 'readonly ' : ''}${item}[]`
  }

  const symbol = type.getAliasSymbol() ?? type.getSymbol()
  return symbol && printed.startsWith(`${symbol.name}<`)
    ? printWritten(types, type, getWrittenTypeArguments(types, type, symbol), keys, depth + 1)
    : printed
}

/** How many keys of an object literal argument name an instantiation */
const OBJECT_LITERAL_KEYS = 3

/**
 * Stands for the `-` of the key part of a name in the printed type, which never holds it (it
 * escapes control characters), so `toDefName` keeps it while it replaces the others.
 */
const KEY_SEPARATOR = '\0'

/**
 * An object literal argument by its first keys, after `with-` (`with-id-title`), which keeps the
 * names it gives apart from those of type arguments (`Page<{ number: string }>` is
 * `Page_with-number`, `Page<number>` is `Page_number`): names from printed types have no `-`, and
 * names of views (see `getViewDefName`) write `-` in place of `_`. Keys are written with letters,
 * digits and inner underscores only (`_avg` as `avg`).
 */
function printKeys(types: TypeQueries, type: Type): string {
  const keys = types
    .getProperties(type)
    .map((p) => p.name.replace(/\W+/gu, '_').replace(/^_+|_+$/gu, ''))
    .filter(Boolean)
    .slice(0, OBJECT_LITERAL_KEYS)

  return keys.length ? ['with', ...keys].join(KEY_SEPARATOR) : ''
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
    // an instantiation by its printed type, as a named def (`DeepPartial_User`)
    const written = getWrittenTypeArguments(types, type, symbol)
    return (
      (written.length &&
        (toDefName(printWritten(types, type, written)) ??
          toDefName(printWritten(types, type, written, true)))) ||
      name
    )
  }

  const printed = toDefName(printType(types, type))
  return printed && printed !== name ? printed : 'Recursive'
}

/**
 * The def name of a type a property annotation writes with a project alias the type itself lost
 * (`author?: XOR<Filter, Where>`, which distributes over `& object`): `XOR_Filter_Where`.
 */
export function getAnnotatedDefName(
  types: TypeQueries,
  annotation: PropertyAnnotation,
): string | undefined {
  const args = annotation.typeArguments.map((t) => printType(types, t))
  return toDefName(`${getSymbolName(annotation.alias)}${args.length ? `<${args.join(', ')}>` : ''}`)
}

/**
 * The def name of a view of a class, like `Readonly_User` for `Readonly<User>`, or `User_View`
 * when the printed type is not usable (`Omit<User, 'id'> & { id?: string }`).
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
 * `Event<"message", Message>` -> `Event_message_Message`, `Pair<[A, B]>` -> `Pair_A_B`,
 * `Pick<User, "id" | "name">` -> `Pick_User_id_name`.
 * Types with object literals, functions, unions, or intersections in their arguments are not named this way.
 */
function toDefName(printed: string): string | undefined {
  // a union of string literals, like the keys of `Pick<User, "id" | "name">`, names each of them
  const text = printed.replace(/"\s*\|\s*"/gu, '", "')

  if (text.length > 80 || /[{}()|&]|=>|\.\.\./u.test(text) || !/^[\w$.]+(?:<.*>)?$/u.test(text)) {
    return undefined
  }

  return (
    text
      .replace(/\[\]/gu, 'Array')
      .replace(/-(?=\d)/gu, 'neg')
      .replace(/[^\w$.\0]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .replaceAll(KEY_SEPARATOR, '-') || undefined
  )
}

import type { TemplateLiteralType, Type } from 'typescript/unstable/sync'
import { TypeFlags } from 'typescript/unstable/sync'

import { escapeRegExp } from './schema-utils'
import type { TypeQueries } from './type-queries'
import { PRIMITIVE_FLAGS } from './type-queries'

export const LITERAL_FLAGS: number =
  TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BooleanLiteral

/**
 * The key type of an index signature, the primitive or template of a branded key.
 */
export function getIndexKeyType(types: TypeQueries, key: Type): Type | undefined {
  const keyFlags =
    TypeFlags.String | TypeFlags.Number | TypeFlags.TemplateLiteral | TypeFlags.StringMapping

  if (key.flags & keyFlags) {
    return key
  }

  return key.isIntersectionType()
    ? types.getMembers(key).find((member) => member.flags & keyFlags)
    : undefined
}

/**
 * The regular expression of the strings a template literal (or its parts) accepts.
 * The checker folds literal parts (`${null}`, `${true}`) into the texts and distributes
 * unions (`${boolean}`, `${'a' | 'b'}`) over the template, branded literals remain.
 */
export function toPattern(types: TypeQueries, type: Type): string {
  const flags = type.flags

  if (flags & (LITERAL_FLAGS | TypeFlags.BigIntLiteral)) {
    return escapeRegExp(String((type as any).value))
  }

  // what TypeScript accepts: non-empty strings whose `+s` is finite, so also hexadecimal, octal,
  // and binary literals, with whitespace around, and only whitespace (`+' '` is `0`)
  if (flags & TypeFlags.Number) {
    return '(?:\\s+|\\s*(?:[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?|0[xX][\\da-fA-F]+|0[oO][0-7]+|0[bB][01]+)\\s*)'
  }

  // integer literals, also hexadecimal, octal, and binary ones, without whitespace or `+`
  if (flags & TypeFlags.BigInt) {
    return '-?(?:\\d+|0[xX][\\da-fA-F]+|0[oO][0-7]+|0[bB][01]+)'
  }

  if (flags & TypeFlags.TemplateLiteral) {
    const template = type as TemplateLiteralType
    const parts = types.getMembers(template)
    let pattern = escapeRegExp(template.texts[0] ?? '')
    for (let i = 0; i < parts.length; i++) {
      pattern += toPattern(types, parts[i]!) + escapeRegExp(template.texts[i + 1] ?? '')
    }
    return pattern
  }

  if (type.isIntersectionType()) {
    const primitive = types.getMembers(type).find((m) => m.flags & PRIMITIVE_FLAGS)
    if (primitive) {
      return toPattern(types, primitive)
    }
  }

  // `.` does not match line terminators
  return '[\\s\\S]*'
}

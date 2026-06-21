import type { JsonSchema } from './types'
import { get, isPlainObject, toArray, tryOrUndefined } from '@orpc/shared'
import { decodeJsonPointerSegment } from './ref-utils'
import { JsonSchemaXNativeType } from './types'

const FLEXIBLE_DATE_FORMAT_REGEX = /^[^-]+-[^-]+-[^-]+$/

export class JsonSchemaCoercer {
  coerce([schema, optional]: [schema: JsonSchema, optional: boolean], value: unknown): unknown {
    if (optional && value === undefined) {
      return value
    }

    const [, coerced] = this.coerceInternal(schema, schema, value)
    return coerced
  }

  private coerceInternal(rootSchema: JsonSchema, schema: JsonSchema, value: unknown): [satisfied: boolean, coerced: unknown] {
    if (typeof schema === 'boolean') {
      return [schema, value]
    }

    if (Array.isArray(schema.type)) {
      return this.coerceInternal(
        rootSchema,
        { anyOf: schema.type.map(type => ({ ...schema, type })) },
        value,
      )
    }

    let coerced = value
    let satisfied = true

    if (typeof schema.$ref === 'string') {
      const resolved
        = schema.$ref.startsWith('#/')
          ? get(rootSchema, schema.$ref.slice('#/'.length).split('/').map(decodeJsonPointerSegment)) as JsonSchema | undefined
          : schema.$ref === '#'
            ? rootSchema
            : undefined

      if (resolved !== undefined) {
        const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, resolved, coerced)

        coerced = subCoerced
        satisfied = subSatisfied
      }
    }

    const enumValues = schema.const !== undefined ? [schema.const] : schema.enum
    if (enumValues !== undefined && !enumValues.includes(coerced)) {
      if (typeof coerced === 'string') {
        const numberValue = stringToNumber(coerced)

        if (enumValues.includes(numberValue)) {
          coerced = numberValue
        }
        else {
          const booleanValue = stringToBoolean(coerced)

          if (enumValues.includes(booleanValue)) {
            coerced = booleanValue
          }
          else {
            satisfied = false
          }
        }
      }
      else {
        satisfied = false
      }
    }

    if (schema.type) {
      switch (schema.type) {
        case 'null': {
          if (coerced !== null) {
            satisfied = false
          }

          break
        }
        case 'string': {
          if (typeof coerced !== 'string') {
            satisfied = false
          }

          break
        }
        case 'number': {
          if (typeof coerced === 'string') {
            coerced = stringToNumber(coerced)
          }

          if (typeof coerced !== 'number') {
            satisfied = false
          }

          break
        }
        case 'integer': {
          if (typeof coerced === 'string') {
            coerced = stringToInteger(coerced)
          }

          if (typeof coerced !== 'number' || !Number.isInteger(coerced)) {
            satisfied = false
          }

          break
        }
        case 'boolean': {
          if (typeof coerced === 'string') {
            coerced = stringToBoolean(coerced)
          }

          if (typeof coerced !== 'boolean') {
            satisfied = false
          }

          break
        }
        case 'array': {
          if (Array.isArray(coerced)) {
            const prefixItemSchemas: readonly JsonSchema[] = 'prefixItems' in schema
              ? toArray(schema.prefixItems)
              : Array.isArray(schema.items)
                ? schema.items
                : []

            const itemSchema: JsonSchema | undefined = Array.isArray(schema.items)
              ? schema.additionalItems
              : schema.items as JsonSchema | undefined

            let shouldUseCoercedItems = false

            const coercedItems = coerced.map((item, i) => {
              const subSchema = prefixItemSchemas[i] ?? itemSchema
              if (subSchema === undefined) {
                satisfied = false
                return item
              }

              const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, subSchema, item)

              if (!subSatisfied) {
                satisfied = false
              }

              if (subCoerced !== item) {
                shouldUseCoercedItems = true
              }

              return subCoerced
            })

            if (coercedItems.length < prefixItemSchemas.length) {
              satisfied = false
            }

            if (shouldUseCoercedItems) {
              coerced = coercedItems
            }
          }
          else {
            satisfied = false
          }
          break
        }
        case 'object': {
          if (Array.isArray(coerced)) {
            coerced = { ...coerced }
          }

          if (isPlainObject(coerced)) {
            let shouldUseCoercedItems = false
            const coercedItems: Record<string, unknown> = {}

            const patternProperties = Object.entries(schema.patternProperties ?? {})
              .map(([key, value]) => [new RegExp(key), value] as const)

            for (const key in coerced) {
              const value = coerced[key]
              const subSchema = schema.properties?.[key]
                ?? patternProperties.find(([pattern]) => pattern.test(key))?.[1]
                ?? schema.additionalProperties

              if (value === undefined && !schema.required?.includes(key)) {
                coercedItems[key] = value
              }
              else if (subSchema === undefined) {
                coercedItems[key] = value
                satisfied = false
              }
              else {
                const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, subSchema, value)
                coercedItems[key] = subCoerced

                if (!subSatisfied) {
                  satisfied = false
                }

                if (subCoerced !== value) {
                  shouldUseCoercedItems = true
                }
              }
            }

            if (schema.required?.some(key => !Object.hasOwn(coercedItems, key))) {
              satisfied = false
            }

            if (shouldUseCoercedItems) {
              coerced = coercedItems
            }
          }
          else {
            satisfied = false
          }

          break
        }
      }
    }

    if ('x-native-type' in schema && typeof schema['x-native-type'] === 'string') {
      switch (schema['x-native-type']) {
        case JsonSchemaXNativeType.Date: {
          if (typeof coerced === 'string') {
            coerced = stringToDate(coerced)
          }

          if (!(coerced instanceof Date)) {
            satisfied = false
          }

          break
        }
        case JsonSchemaXNativeType.BigInt: {
          switch (typeof coerced) {
            case 'string':
              coerced = stringToBigInt(coerced)
              break
            case 'number':
              coerced = numberToBigInt(coerced)
              break
          }

          if (typeof coerced !== 'bigint') {
            satisfied = false
          }

          break
        }
        case JsonSchemaXNativeType.RegExp: {
          if (typeof coerced === 'string') {
            coerced = stringToRegExp(coerced)
          }

          if (!(coerced instanceof RegExp)) {
            satisfied = false
          }

          break
        }
        case JsonSchemaXNativeType.Url: {
          if (typeof coerced === 'string') {
            coerced = stringToURL(coerced)
          }

          if (!(coerced instanceof URL)) {
            satisfied = false
          }

          break
        }
        case JsonSchemaXNativeType.Set: {
          if (Array.isArray(coerced)) {
            coerced = arrayToSet(coerced)
          }

          if (!(coerced instanceof Set)) {
            satisfied = false
          }

          break
        }
        case JsonSchemaXNativeType.Map: {
          if (Array.isArray(coerced)) {
            coerced = arrayToMap(coerced)
          }

          if (!(coerced instanceof Map)) {
            satisfied = false
          }

          break
        }
      }
    }

    if (schema.allOf) {
      for (const subSchema of schema.allOf) {
        const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, subSchema, coerced)

        coerced = subCoerced

        if (!subSatisfied) {
          satisfied = false
        }
      }
    }

    for (const key of ['anyOf', 'oneOf'] as const) {
      if (schema[key]) {
        let bestOptions: { coerced: unknown, satisfied: boolean } | undefined

        for (const subSchema of schema[key]) {
          const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, subSchema, coerced)

          if (subSatisfied) {
            if (!bestOptions || subCoerced === coerced) {
              bestOptions = { coerced: subCoerced, satisfied: subSatisfied }
            }

            if (subCoerced === coerced) {
              break
            }
          }
        }

        coerced = bestOptions ? bestOptions.coerced : coerced
        satisfied = bestOptions ? bestOptions.satisfied : false
      }
    }

    if (typeof schema.not !== 'undefined') {
      const [notSatisfied] = this.coerceInternal(rootSchema, schema.not, coerced)

      if (notSatisfied) {
        satisfied = false
      }
    }

    return [satisfied, coerced]
  }
}

function stringToNumber(value: string): number | string {
  const num = Number.parseFloat(value)

  if (Number.isNaN(num) || num !== Number(value)) {
    return value
  }

  return num
}

function stringToInteger(value: string): number | string {
  const num = Number.parseInt(value)

  if (Number.isNaN(num) || num !== Number(value)) {
    return value
  }

  return num
}

function stringToBoolean(value: string): boolean | string {
  const lower = value.toLowerCase()

  if (lower === 'false' || lower === 'off') {
    return false
  }

  if (lower === 'true' || lower === 'on') {
    return true
  }

  return value
}

function stringToBigInt(value: string): bigint | string {
  return tryOrUndefined(() => BigInt(value)) ?? value
}

function numberToBigInt(value: number): bigint | number {
  return tryOrUndefined(() => BigInt(value)) ?? value
}

function stringToDate(value: string): Date | string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime()) || !FLEXIBLE_DATE_FORMAT_REGEX.test(value)) {
    return value
  }

  return date
}

function stringToRegExp(value: string): RegExp | string {
  const match = value.match(/^\/(.*)\/([a-z]*)$/)

  if (match) {
    const [, pattern, flags] = match
    return tryOrUndefined(() => new RegExp(pattern!, flags)) ?? value
  }

  return value
}

function stringToURL(value: string): URL | string {
  return tryOrUndefined(() => new URL(value)) ?? value
}

function arrayToSet(value: unknown[]): Set<unknown> | unknown[] {
  const set = new Set(value)

  if (set.size !== value.length) {
    return value
  }

  return set
}

function arrayToMap(value: unknown[]): Map<unknown, unknown> | unknown[] {
  if (value.some(item => !Array.isArray(item) || item.length !== 2)) {
    return value
  }

  const result = new Map(value as [unknown, unknown][])

  if (result.size !== value.length) {
    return value
  }

  return result
}

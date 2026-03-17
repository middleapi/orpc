import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin } from '@orpc/server/standard'
import type {
  EnumLike,
  ZodArray,
  ZodBranded,
  ZodCatch,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEffects,
  ZodIntersection,
  ZodLazy,
  ZodLiteral,
  ZodMap,
  ZodNativeEnum,
  ZodNullable,
  ZodObject,
  ZodOptional,
  ZodPipeline,
  ZodReadonly,
  ZodRecord,
  ZodSet,
  ZodTuple,
  ZodTypeAny,
  ZodUnion,
} from 'zod/v3'
import { guard, isObject } from '@orpc/shared'
import { ZodFirstPartyTypeKind } from 'zod/v3'
import { getCustomZodDef } from './schemas/base'

export class ZodSmartCoercionPlugin<TContext extends Context> implements StandardHandlerPlugin<TContext> {
  init(options: StandardHandlerOptions<TContext>): void {
    options.clientInterceptors ??= []

    options.clientInterceptors.unshift((options) => {
      const inputSchema = options.procedure['~orpc'].inputSchema

      if (!inputSchema || inputSchema['~standard'].vendor !== 'zod' || '_zod' in inputSchema /** < zod4 */) {
        return options.next()
      }

      const coercedInput = zodCoerceInternal(inputSchema as ZodTypeAny, options.input)

      return options.next({ ...options, input: coercedInput })
    })
  }
}

function zodCoerceInternal(
  schema: ZodTypeAny,
  value: unknown,
): unknown {
  const customZodDef = getCustomZodDef(schema._def)

  switch (customZodDef?.type) {
    case 'regexp': {
      if (typeof value === 'string') {
        return safeToRegExp(value)
      }

      return value
    }

    case 'url': {
      if (typeof value === 'string') {
        return safeToURL(value)
      }

      return value
    }
  }

  const typeName = schema._def.typeName as ZodFirstPartyTypeKind | undefined

  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodNumber: {
      if (typeof value === 'string') {
        return safeToNumber(value)
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodBigInt: {
      if (typeof value === 'string') {
        return safeToBigInt(value)
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodBoolean: {
      if (typeof value === 'string') {
        return safeToBoolean(value)
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodDate: {
      if (typeof value === 'string') {
        return safeToDate(value)
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodLiteral: {
      const schema_ = schema as ZodLiteral<unknown>
      const expectedValue = schema_._def.value

      if (typeof value === 'string' && typeof expectedValue !== 'string') {
        if (typeof expectedValue === 'bigint') {
          return safeToBigInt(value)
        }
        else if (typeof expectedValue === 'number') {
          return safeToNumber(value)
        }
        else if (typeof expectedValue === 'boolean') {
          return safeToBoolean(value)
        }
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      const schema_ = schema as ZodNativeEnum<EnumLike>

      if (Object.values(schema_._def.values).includes(value as any)) {
        return value
      }

      if (typeof value === 'string') {
        for (const expectedValue of Object.values(schema_._def.values)) {
          if (expectedValue.toString() === value) {
            return expectedValue
          }
        }
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodObject: {
      const schema_ = schema as ZodObject<{ [k: string]: ZodTypeAny }>

      if (isObject(value)) {
        const newObj: Record<string, unknown> = {}

        const keys = new Set([
          ...Object.keys(value),
          ...Object.keys(schema_.shape),
        ])

        for (const k of keys) {
          newObj[k] = zodCoerceInternal(
            schema_.shape[k] ?? schema_._def.catchall,
            value[k],
          )
        }

        return newObj
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodRecord: {
      const schema_ = schema as ZodRecord

      if (isObject(value)) {
        const newObj: any = {}

        for (const [k, v] of Object.entries(value)) {
          const key = zodCoerceInternal(schema_._def.keyType, k)
          const val = zodCoerceInternal(schema_._def.valueType, v)
          newObj[key as any] = val
        }

        return newObj
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodArray: {
      const schema_ = schema as ZodArray<ZodTypeAny>

      if (Array.isArray(value)) {
        return value.map(v => zodCoerceInternal(schema_._def.type, v))
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodTuple: {
      const schema_ = schema as ZodTuple<[ZodTypeAny, ...ZodTypeAny[]], ZodTypeAny | null>

      if (Array.isArray(value)) {
        return value.map((v, i) => {
          const s = schema_._def.items[i] ?? schema_._def.rest
          return s ? zodCoerceInternal(s, v) : v
        })
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodSet: {
      const schema_ = schema as ZodSet

      if (Array.isArray(value)) {
        return new Set(
          value.map(v => zodCoerceInternal(schema_._def.valueType, v)),
        )
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodMap : {
      const schema_ = schema as ZodMap

      if (
        Array.isArray(value)
        && value.every(i => Array.isArray(i) && i.length === 2)
      ) {
        return new Map(
          value.map(([k, v]) => [
            zodCoerceInternal(schema_._def.keyType, k),
            zodCoerceInternal(schema_._def.valueType, v),
          ]),
        )
      }

      return value
    }

    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const schema_ = schema as
        | ZodUnion<[ZodTypeAny]>
        | ZodDiscriminatedUnion<any, [ZodObject<any>]>

      if (schema_.safeParse(value).success) {
        return value
      }

      const results: [unknown, number][] = []
      for (const s of schema_._def.options) {
        const newValue = zodCoerceInternal(s, value)

        const result = schema_.safeParse(newValue)

        if (result.success) {
          return newValue
        }

        results.push([newValue, result.error.issues.length])
      }

      if (results.length === 0) {
        return value
      }

      return results.sort((a, b) => a[1] - b[1])[0]![0]
    }

    case ZodFirstPartyTypeKind.ZodIntersection: {
      const schema_ = schema as ZodIntersection<ZodTypeAny, ZodTypeAny>

      return zodCoerceInternal(
        schema_._def.right,
        zodCoerceInternal(schema_._def.left, value),
      )
    }

    case ZodFirstPartyTypeKind.ZodReadonly :{
      const schema_ = schema as ZodReadonly<ZodTypeAny>
      return zodCoerceInternal(schema_._def.innerType, value)
    }

    case ZodFirstPartyTypeKind.ZodPipeline: {
      const schema_ = schema as ZodPipeline<ZodTypeAny, ZodTypeAny>
      return zodCoerceInternal(schema_._def.in, value)
    }

    case ZodFirstPartyTypeKind.ZodEffects: {
      const schema_ = schema as ZodEffects<ZodTypeAny>
      return zodCoerceInternal(schema_._def.schema, value)
    }

    case ZodFirstPartyTypeKind.ZodBranded: {
      const schema_ = schema as ZodBranded<ZodTypeAny, any>
      return zodCoerceInternal(schema_._def.type, value)
    }

    case ZodFirstPartyTypeKind.ZodCatch: {
      const schema_ = schema as ZodCatch<ZodTypeAny>
      return zodCoerceInternal(schema_._def.innerType, value)
    }

    case ZodFirstPartyTypeKind.ZodDefault: {
      const schema_ = schema as ZodDefault<ZodTypeAny>
      return zodCoerceInternal(schema_._def.innerType, value)
    }

    case ZodFirstPartyTypeKind.ZodNullable: {
      if (value === null) {
        return null
      }

      const schema_ = schema as ZodNullable<ZodTypeAny>
      return zodCoerceInternal(schema_._def.innerType, value)
    }

    case ZodFirstPartyTypeKind.ZodOptional: {
      if (value === undefined) {
        return undefined
      }

      const schema_ = schema as ZodOptional<ZodTypeAny>
      return zodCoerceInternal(schema_._def.innerType, value)
    }

    case ZodFirstPartyTypeKind.ZodLazy: {
      const schema_ = schema as ZodLazy<ZodTypeAny>

      if (value !== undefined) {
        return zodCoerceInternal(schema_._def.getter(), value)
      }

      return value
    }
  }

  const _unsupported:
    | undefined
    | ZodFirstPartyTypeKind.ZodUndefined
    | ZodFirstPartyTypeKind.ZodVoid
    | ZodFirstPartyTypeKind.ZodNull
    | ZodFirstPartyTypeKind.ZodNaN
    | ZodFirstPartyTypeKind.ZodString
    | ZodFirstPartyTypeKind.ZodEnum
    | ZodFirstPartyTypeKind.ZodSymbol
    | ZodFirstPartyTypeKind.ZodPromise
    | ZodFirstPartyTypeKind.ZodFunction
    | ZodFirstPartyTypeKind.ZodAny
    | ZodFirstPartyTypeKind.ZodUnknown
    | ZodFirstPartyTypeKind.ZodNever = typeName

  return value
}

function safeToBigInt(value: string): bigint | string {
  return guard(() => BigInt(value)) ?? value
}

function safeToNumber(value: string): number | string {
  const num = Number(value)
  return Number.isNaN(num) || num.toString() !== value ? value : num
}

function safeToBoolean(value: string): boolean | string {
  const lower = value.toLowerCase()

  if (lower === 'false' || lower === 'off' || lower === 'f') {
    return false
  }

  if (lower === 'true' || lower === 'on' || lower === 't') {
    return true
  }

  return value
}

function safeToRegExp(value: string): RegExp | string {
  if (value.startsWith('/')) {
    const match = value.match(/^\/(.*)\/([a-z]*)$/)

    if (match) {
      const [, pattern, flags] = match
      return new RegExp(pattern!, flags)
    }
  }

  return value
}

function safeToURL(value: string): URL | string {
  return guard(() => new URL(value)) ?? value
}

function safeToDate(value: string): Date | string {
  const date = new Date(value)

  if (!Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)) {
    return date
  }

  return value
}

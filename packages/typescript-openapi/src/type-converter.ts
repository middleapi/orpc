import type { JsonSchema } from '@orpc/json-schema'
import { setOwn } from '@orpc/shared'
import type {
  Checker,
  Program,
  Symbol as TSSymbol,
  TemplateLiteralType,
  Type,
  TypeReference,
} from 'typescript/unstable/sync'
import { ElementFlags, SignatureKind, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

import type { Builtin } from './builtins.ts'
import { getBuiltin, getMappedBuiltin, isBuiltinSymbol, TYPED_ARRAYS } from './builtins.ts'
import { getDefName, getFallbackDefName } from './def-names.ts'
import { DefRegistry } from './defs.ts'
import { ExpansionGuard } from './expansion.ts'
import {
  getClassType,
  getDataProperties,
  getToJSONResultType,
  isDropped,
  isNonSerializable,
  ModeSensitivity,
} from './json-rules.ts'
import type { ObjectJsonSchema } from './schema-utils.ts'
import {
  applyJSDoc,
  bigintSchema,
  dedupe,
  escapeRegExp,
  isLiteralSchema,
  isPlain,
  isTrivialSchema,
  mapSchema,
  setSchema,
  toRef,
  withNull,
} from './schema-utils.ts'
import {
  getNamedSymbol,
  INSTANTIABLE_FLAGS,
  isObjectLiteral,
  NULLISH_FLAGS,
  PRIMITIVE_FLAGS,
  TypeQueries,
  UNDEFINED_FLAGS,
} from './type-queries.ts'
import { getIteratorTypes } from './utils.ts'

/**
 * A type the converter cannot resolve, such as an unresolved import.
 */
export class TypeScriptTypeResolutionError extends TypeError {}

export interface TypeToJsonSchemaConverterOptions {
  /**
   * Which named types become `$defs` (and so OpenAPI components).
   *
   * - `named`: interfaces, classes, enums, and type aliases declared outside `node_modules` and the default library.
   * - `recursive`: only types that reference themselves, which can not be inlined.
   *
   * @default 'named'
   */
  defs?: 'named' | 'recursive' | undefined
}

export interface TypeToJsonSchemaConvertOptions {
  /**
   * Inline the root def (and the defs of a root union) when it is not recursive,
   * for schemas that are split into parts like path params, query, headers, and body,
   * where a def of the whole would become an unused component.
   *
   * @default false
   */
  inlineRoot?: boolean | undefined

  /**
   * With `inlineRoot`, also inline the defs of these root properties,
   * like `params` and `query` of a detailed input, or `status` and `headers` of a detailed output.
   */
  inlineProperties?: readonly string[] | undefined
}

export interface AsyncIteratorTypes {
  yieldType: Type
  returnType: Type
}

const LITERAL_FLAGS = TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BooleanLiteral

/**
 * Converts TypeScript types into JSON Schemas (draft 2020-12), describing values
 * as they look after oRPC's OpenAPI JSON serialization, e.g. `Date` as a `date-time` string.
 *
 * Named types are emitted as `$defs`. Conversions share a cache, so reuse one converter per program.
 *
 * @see {@link https://orpc.dev/docs/openapi/type-inference#converting-types-directly | OpenAPI Type Inference - Converting Types Directly}
 */
export class TypeToJsonSchemaConverter {
  private readonly defsMode: 'named' | 'recursive'
  private readonly types: TypeQueries
  private readonly defs = new DefRegistry()
  private readonly expansion: ExpansionGuard
  private readonly sensitivity: ModeSensitivity

  /** Anonymous types being converted, with the named depth they were entered at */
  private readonly visiting = new Map<number, number>()
  private readonly visitingStack: { type: Type; key: number }[] = []
  /** Types that close a cycle, preferred over wrappers around them for the def */
  private readonly cycleClosers = new Set<number>()
  /** Non-null cores of named nullable unions, back to the union (`Json` without `null` -> `Json`) */
  private readonly nullableCores = new Map<number, Type>()
  private namedDepth = 0

  /**
   * Inside class instances, which the OpenAPI JSON serializer leaves to `JSON.stringify`:
   * `Set`, `Map`, and `Blob` become `{}`, and `bigint` can not be serialized.
   */
  private stringify = false

  constructor(
    private readonly checker: Checker,
    program: Program,
    options: TypeToJsonSchemaConverterOptions = {},
  ) {
    this.defsMode = options.defs ?? 'named'
    this.types = new TypeQueries(checker, program)
    this.expansion = new ExpansionGuard(this.types)
    this.sensitivity = new ModeSensitivity(this.types)
  }

  /**
   * Converts a type, returning its schema, with the `$defs` it references, and whether it accepts `undefined`.
   */
  convert(
    type: Type,
    options: TypeToJsonSchemaConvertOptions = {},
  ): [jsonSchema: JsonSchema, optional: boolean] {
    type = this.getAwaitedType(type)
    const optional = this.isOptional(type)

    const cuts = this.expansion.cuts
    this.expansion.reset()

    let schema: JsonSchema
    let $defs: Record<string, JsonSchema>

    try {
      schema = this.visit(type)

      if (options.inlineRoot) {
        schema = this.defs.inlineRoot(schema, options.inlineProperties ?? [])
      }

      $defs = this.defs.getReferencedDefs(schema)
    } catch (error) {
      // defs of a failed conversion may be unfinished or reference unfinished ones
      this.defs.discardCreated()
      throw error
    }

    // a cut expansion depends on where the conversion started, so it is not reused
    if (this.expansion.cuts !== cuts) {
      this.defs.discardCreated()
    } else {
      this.defs.keepCreated()
    }

    if (!Object.keys($defs).length) {
      return [schema, optional]
    }

    return [{ ...(typeof schema === 'object' ? schema : { not: {} }), $defs }, optional]
  }

  /**
   * Returns the yield and return types when the type is an async iterable, such as an `AsyncGenerator`.
   */
  getAsyncIteratorTypes(type: Type): AsyncIteratorTypes | undefined {
    if (!(type.flags & TypeFlags.Object)) {
      return undefined
    }

    const types = getIteratorTypes(this.checker, type, this.types.getProperties(type), true)

    return (
      types && {
        yieldType: types.yieldType,
        returnType: types.returnType ?? this.checker.getVoidType(),
      }
    )
  }

  /**
   * Whether the value can be `undefined`, i.e. omitted.
   */
  isOptional(type: Type): boolean {
    return Boolean(
      type.flags & (UNDEFINED_FLAGS | TypeFlags.Any | TypeFlags.Unknown) ||
      this.types.hasMember(type, UNDEFINED_FLAGS),
    )
  }

  /**
   * The value of a `Promise`, like a handler's result.
   */
  private getAwaitedType(type: Type): Type {
    const symbol = type.flags & TypeFlags.Object ? type.getSymbol() : undefined

    if (
      symbol &&
      (symbol.name === 'Promise' || symbol.name === 'PromiseLike') &&
      this.types.getSymbolSourceKind(symbol) === 'default'
    ) {
      const [value] = this.types.getReferenceArguments(type)
      return value ? this.getAwaitedType(value) : type
    }

    return type
  }

  private visit(type: Type): JsonSchema {
    const key = this.key(type)
    const existing = this.defs.get(key)

    if (existing) {
      return { $ref: toRef(existing.name) }
    }

    if (type.isErrorType()) {
      throw new TypeScriptTypeResolutionError(
        `Could not resolve the type "${this.checker.typeToString(type)}". Check its import, and the tsconfig "paths" for aliases like "@/".`,
      )
    }

    const singleMemberEnum = this.types.getSingleMemberEnum(type)

    if (!(type.flags & (TypeFlags.Object | TypeFlags.UnionOrIntersection)) && !singleMemberEnum) {
      return this.convertType(type)
    }

    return this.expansion.expand(type, () => this.visitStructured(type, singleMemberEnum)) ?? {}
  }

  private visitStructured(type: Type, singleMemberEnum: TSSymbol | undefined): JsonSchema {
    const key = this.key(type)
    const memoized = this.defs.getAnonymous(key)

    if (memoized !== undefined) {
      return memoized
    }

    const namedSymbol = singleMemberEnum ?? getNamedSymbol(type)
    const projectSymbol =
      namedSymbol && this.types.getSymbolSourceKind(namedSymbol) === 'project'
        ? namedSymbol
        : undefined

    if (this.defsMode === 'named' && projectSymbol && !(type.flags & TypeFlags.Boolean)) {
      const def = this.defs.create(key, getDefName(this.types, type, projectSymbol))

      this.namedDepth++
      let schema: JsonSchema
      try {
        schema = this.annotate(this.convertType(type), projectSymbol)
      } finally {
        this.namedDepth--
      }

      // a named primitive, like `type UserId = string & { __brand: 'UserId' }`, is clearer inline.
      // It has no refs, so nothing references the def yet.
      if (isTrivialSchema(schema)) {
        this.defs.inline(def, schema)
        return schema
      }

      def.schema = schema
      return { $ref: toRef(def.name) }
    }

    const enteredAt = this.visiting.get(key)

    // the same anonymous type again, without a named def in between to stop at: a cycle.
    // Through a named def (`Tree[]` in `Tree`), converting it again ends at that def.
    if (enteredAt === this.namedDepth) {
      const closer = this.getCycleCloser(type, key)

      if (closer === undefined) {
        return { $ref: toRef(this.defs.create(key, getFallbackDefName(this.checker, type)).name) }
      }

      // convert this wrapper (`TreeNode[]`) once more, so the cycle closes at `TreeNode` instead
      this.cycleClosers.add(closer.key)
    }

    this.visiting.set(key, this.namedDepth)
    this.visitingStack.push({ type, key })
    const cuts = this.expansion.cuts

    let schema: JsonSchema
    try {
      schema = this.convertType(type)
    } finally {
      this.visitingStack.pop()
      if (enteredAt === undefined) {
        this.visiting.delete(key)
      } else {
        this.visiting.set(key, enteredAt)
      }
    }

    if (projectSymbol) {
      schema = this.annotate(schema, projectSymbol)
    }

    // a self reference was found while converting, so the type became a def
    const def = this.defs.get(key)

    if (def) {
      def.schema ??= schema
      return { $ref: toRef(def.name) }
    }

    // reuse it for siblings, `{ a: C<N>; b: C<N> }` would otherwise grow exponentially in time
    if (enteredAt === undefined && cuts === this.expansion.cuts) {
      this.defs.setAnonymous(key, schema)
    }

    return schema
  }

  /**
   * When a cycle comes back to a type without a good name, like `TreeNode[]` or
   * `Record<string, Dict>`, returns the named type in the cycle (`TreeNode`) to make the def for.
   */
  private getCycleCloser(type: Type, key: number): { type: Type; key: number } | undefined {
    if (this.cycleClosers.has(key) || this.hasCycleName(type)) {
      return undefined
    }

    const start = this.visitingStack.findIndex((entry) => entry.key === key)

    // converted once more already, the closer did not come back
    if (this.visitingStack.filter((entry) => entry.key === key).length > 1) {
      return undefined
    }

    return this.visitingStack.slice(start + 1).find((entry) => this.hasCycleName(entry.type))
  }

  private hasCycleName(type: Type): boolean {
    const symbol = getNamedSymbol(type)

    return Boolean(
      symbol &&
      !symbol.name.startsWith('__') &&
      this.types.getSymbolSourceKind(symbol) !== 'default',
    )
  }

  private convertType(type: Type): JsonSchema {
    const flags = type.flags

    if (flags & (TypeFlags.Any | TypeFlags.Unknown | UNDEFINED_FLAGS)) {
      return {}
    }

    if (flags & TypeFlags.Never) {
      return { not: {} }
    }

    if (flags & TypeFlags.Null) {
      return { type: 'null' }
    }

    if (flags & TypeFlags.Boolean) {
      return { type: 'boolean' }
    }

    if (flags & TypeFlags.BooleanLiteral) {
      return { type: 'boolean', const: (type as any).value }
    }

    if (flags & TypeFlags.StringLiteral) {
      return { type: 'string', const: (type as any).value }
    }

    if (flags & TypeFlags.NumberLiteral) {
      return { type: 'number', const: (type as any).value }
    }

    if (flags & TypeFlags.BigIntLike) {
      if (this.stringify) {
        // `JSON.stringify` throws on a bigint
        return { not: {} }
      }

      return flags & TypeFlags.BigIntLiteral
        ? { ...bigintSchema(), const: String((type as any).value) }
        : bigintSchema()
    }

    if (flags & TypeFlags.String) {
      return { type: 'string' }
    }

    // includes computed enum members, e.g. `enum E { A = key.length }`
    if (flags & (TypeFlags.NumberLike | TypeFlags.Enum)) {
      return { type: 'number' }
    }

    if (flags & TypeFlags.TemplateLiteral) {
      return { type: 'string', pattern: `^${toPattern(this.types, type)}$` }
    }

    if (flags & TypeFlags.StringMapping) {
      return { type: 'string' }
    }

    if (flags & TypeFlags.NonPrimitive) {
      return { type: 'object' }
    }

    if (type.isUnionType()) {
      return this.convertNullableUnion(type, this.types.getMembers(type))
    }

    if (type.isIntersectionType()) {
      return this.convertIntersection(type, this.types.getMembers(type))
    }

    if (flags & TypeFlags.Object) {
      return this.convertObject(type)
    }

    if (flags & INSTANTIABLE_FLAGS) {
      const constraint = this.checker.getBaseConstraintOfType(type)

      if (constraint && constraint.id !== type.id) {
        return this.visit(constraint)
      }
    }

    return {}
  }

  /**
   * `undefined` members are left to the caller (optional), `null` adds a `null` branch.
   * The rest is visited as its own type, so a named union keeps its name (`Status | null`).
   */
  private convertNullableUnion(type: Type, members: readonly Type[]): JsonSchema {
    const concrete = members.filter((m) => !(m.flags & NULLISH_FLAGS))
    const core =
      concrete.length > 1 && concrete.length < members.length
        ? this.checker.getNonNullableType(type)
        : undefined

    // without `strictNullChecks` the checker returns the union itself
    if (core && core.id !== type.id && !(core.flags & TypeFlags.Never)) {
      const hasNull = members.some((m) => m.flags & TypeFlags.Null)

      // `Json | undefined` inside `type Json = ... | null` is `Json` again
      // only while that union is being converted, an unrelated `boolean | null` is not `Flag`
      const named = this.nullableCores.get(core.id)
      if (named && named.id !== type.id && hasNull && this.defs.isConverting(this.key(named))) {
        return this.visit(named)
      }

      if (hasNull && type.getAliasSymbol() && !this.types.hasMember(type, UNDEFINED_FLAGS)) {
        this.nullableCores.set(core.id, type)
      }

      return withNullBranch(this.visit(core), hasNull)
    }

    return this.convertMembers(members)
  }

  private convertUnion(members: readonly Type[]): JsonSchema | undefined {
    const strings = new Set<string>()
    const numbers = new Set<number>()
    const booleans = new Set<boolean>()
    const schemas: JsonSchema[] = []

    for (const member of members) {
      if (member.flags & LITERAL_FLAGS && !this.types.getSingleMemberEnum(member)) {
        const value = (member as any).value
        if (member.flags & TypeFlags.StringLiteral) {
          strings.add(value)
        } else if (member.flags & TypeFlags.NumberLiteral) {
          numbers.add(value)
        } else {
          booleans.add(value)
        }
      } else if (!(member.flags & NULLISH_FLAGS)) {
        schemas.push(this.visit(member))
      }
    }

    const literals: JsonSchema[] = []

    for (const [values, type] of [
      [strings, 'string'],
      [numbers, 'number'],
    ] as const) {
      // `'a' | (string & {})` is just a string
      if (values.size && !schemas.some((s) => isPlain(s, type))) {
        const [first] = values
        literals.push(values.size === 1 ? { type, const: first } : { type, enum: [...values] })
      }
    }

    if (booleans.size) {
      const [first] = booleans
      literals.push(booleans.size === 2 ? { type: 'boolean' } : { type: 'boolean', const: first })
    }

    const anyOf = dedupe([...literals, ...schemas])

    if (anyOf.length === 0) {
      return undefined
    }

    return anyOf.length === 1 ? anyOf[0]! : { anyOf }
  }

  private convertIntersection(type: Type, members: readonly Type[]): JsonSchema {
    // branded primitives, e.g. `string & { __brand: 'UserId' }`
    const primitive = members.find((m) => m.flags & PRIMITIVE_FLAGS)
    if (primitive) {
      return this.visit(primitive)
    }

    const arrayLike = members.find((m) => this.types.getReferenceKind(m) !== undefined)
    if (arrayLike) {
      return this.visit(arrayLike)
    }

    // branded built-ins, e.g. `Date & { __brand: 'CreatedAt' }`
    for (const member of members) {
      const builtin =
        member.flags & TypeFlags.Object ? this.convertBuiltinObject(member) : undefined
      if (builtin !== undefined) {
        return builtin
      }
    }

    return this.convertObject(type)
  }

  private convertObject(type: Type, ignoreToJSON = false): JsonSchema {
    const referenceKind = this.types.getReferenceKind(type)

    if (referenceKind === 'array') {
      return { type: 'array', items: this.visitElement(this.types.getReferenceArguments(type)[0]) }
    }

    if (referenceKind === 'tuple') {
      return this.convertTuple(type as TypeReference)
    }

    const builtin = this.convertBuiltin(
      getBuiltin(this.types, type, this.stringify) ??
        getMappedBuiltin(this.types, type, this.stringify),
    )
    if (builtin !== undefined) {
      return builtin
    }

    // the class behind `Readonly<C>`, `Pick<C, K>`, or `C & { extra }` (`Object.freeze`, `Object.assign`)
    const classType = getClassType(this.types, type)

    if (classType && classType.id !== type.id) {
      const subclass = this.convertBuiltinObject(classType)
      if (subclass !== undefined) {
        return subclass
      }
    }

    const properties = this.types.getProperties(type)

    const toJSONResult = ignoreToJSON
      ? undefined
      : getToJSONResultType(this.types, type, this.stringify)
    if (toJSONResult) {
      return this.withStringify(() => this.convertToJSONResult(toJSONResult))
    }

    const isClassInstance = classType !== undefined
    const dataProperties = getDataProperties(this.types, properties, classType)

    if (
      dataProperties.length === 0 &&
      this.checker.getSignaturesOfType(type, SignatureKind.Call).length
    ) {
      // functions are not serializable
      return {}
    }

    // the empty object type `{}` (also `NonNullable<unknown>`) accepts any value but `null` and `undefined`
    if (
      !properties.length &&
      !isClassInstance &&
      !isObjectLiteral(type) &&
      !this.checker.getIndexInfosOfType(type).length &&
      !this.checker.getSignaturesOfType(type, SignatureKind.Construct).length
    ) {
      return {}
    }

    const arrayLike = this.convertArrayLikeObject(properties)
    if (arrayLike !== undefined) {
      return arrayLike
    }

    const convertValue = (value: Type) =>
      isClassInstance ? this.visitInClassInstance(value) : this.visit(value)

    const schema: ObjectJsonSchema & { properties: Record<string, JsonSchema> } = {
      type: 'object',
      properties: {},
    }
    const required: string[] = []

    const propertyTypes = dataProperties.length ? this.checker.getTypeOfSymbol(dataProperties) : []

    for (let i = 0; i < dataProperties.length; i++) {
      const property = dataProperties[i]!
      const propertyType = propertyTypes[i]

      // functions, symbols, and always `undefined` values are dropped by JSON serialization,
      // also when `toJSON` returns them
      const serialized =
        propertyType && getToJSONResultType(this.types, propertyType, this.stringify)
      if (
        !propertyType ||
        isDropped(this.types, propertyType) ||
        (serialized && isDropped(this.types, serialized))
      ) {
        continue
      }

      // `string | (() => void)`: JSON serialization drops the key when it holds a function
      const serializable = this.getSerializableMembers(propertyType)

      let propertySchema = serializable
        ? this.convertMembers(serializable)
        : convertValue(this.getNullableAliasType(property, propertyType) ?? propertyType)

      // an alias of a primitive or literal (`type Count = number`) leaves no trace in the type,
      // so its JSDoc is read through the property's type annotation
      if (isTrivialSchema(propertySchema) || isLiteralSchema(propertySchema)) {
        propertySchema = this.annotate(
          propertySchema,
          this.getAnnotationAlias(property, propertyType),
        )
      }

      // a `__proto__` key must be an own property, not the object's prototype
      setOwn(schema.properties, property.name, this.annotate(propertySchema, property))

      if (
        !serializable &&
        !(property.flags & SymbolFlags.Optional) &&
        !this.isOptional(propertyType) &&
        !(serialized && this.isOptional(serialized))
      ) {
        required.push(property.name)
      }
    }

    if (required.length) {
      schema.required = required
    }

    this.convertIndexSignatures(type, schema, convertValue)

    if (!Object.keys(schema.properties).length) {
      delete (schema as ObjectJsonSchema).properties
    }

    return schema
  }

  /**
   * A string (or number) index covers every key, narrower template literal keys add nothing.
   * Branded keys (`Record<UserId, User>`) are keys of their primitive or template.
   */
  private convertIndexSignatures(
    type: Type,
    schema: ObjectJsonSchema & { properties: Record<string, JsonSchema> },
    convertValue: (value: Type) => JsonSchema,
  ): void {
    // like properties, functions and symbols are dropped (`Record<string, string | (() => void)>`)
    const convertEntry = (value: Type) => {
      const serializable = this.getSerializableMembers(value)
      return serializable ? this.convertMembers(serializable) : convertValue(value)
    }

    const keys = this.checker.getIndexInfosOfType(type).map((info) => ({
      info,
      key: getIndexKeyType(this.types, info.keyType),
    }))
    const anyKey =
      keys.find(({ key }) => key && key.flags & TypeFlags.String) ??
      keys.find(({ key }) => key && key.flags & TypeFlags.Number)
    const patternKeys = keys.filter(
      ({ key }) => key && key.flags & (TypeFlags.TemplateLiteral | TypeFlags.StringMapping),
    )

    if (anyKey) {
      schema.additionalProperties = convertEntry(anyKey.info.valueType)
    } else if (patternKeys.length === 1 && !Object.keys(schema.properties).length) {
      // like zod records with template literal keys, which keeps the value type in OpenAPI 3.0
      schema.propertyNames = {
        type: 'string',
        pattern: `^${toPattern(this.types, patternKeys[0]!.key!)}$`,
      }
      schema.additionalProperties = convertEntry(patternKeys[0]!.info.valueType)
    } else {
      for (const { info, key } of patternKeys) {
        schema.patternProperties ??= {}
        setOwn(
          schema.patternProperties,
          `^${toPattern(this.types, key!)}$`,
          convertEntry(info.valueType),
        )
      }
    }
  }

  private convertTuple(type: TypeReference): JsonSchema {
    const target = type.getTarget() as Type & { elementFlags?: readonly ElementFlags[] }
    const elementFlags = target.elementFlags ?? []
    const elements = this.types.getReferenceArguments(type).slice(0, elementFlags.length)

    const prefixItems: JsonSchema[] = []
    // the rest element and everything after it, like `number` and `boolean` in `[string, ...number[], boolean]`
    const variableItems: JsonSchema[] = []
    let minItems = 0

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i]!
      const flags = elementFlags[i]!

      if (variableItems.length || flags & ElementFlags.Variable) {
        // a variadic element is an unresolved generic spread (`...T`)
        variableItems.push(flags & ElementFlags.Variadic ? {} : this.visitElement(element))
        if (flags & ElementFlags.Required) {
          minItems++
        }
        continue
      }

      if (flags & ElementFlags.Required) {
        minItems = i + 1
      }

      // an `undefined` element, even an optional one, is serialized as `null`
      prefixItems.push(this.visitElement(element))
    }

    const items = dedupe(variableItems)
    const schema: ObjectJsonSchema = { type: 'array' }

    if (prefixItems.length) {
      schema.prefixItems = prefixItems
    }

    if (items.length) {
      schema.items = items.length === 1 ? items[0]! : { anyOf: items }
    } else {
      schema.maxItems = prefixItems.length
    }

    if (minItems) {
      schema.minItems = minItems
    }

    return schema
  }

  private convertBuiltinObject(type: Type): JsonSchema | undefined {
    return this.convertBuiltin(getBuiltin(this.types, type, this.stringify))
  }

  private convertBuiltin(builtin: Builtin | undefined): JsonSchema | undefined {
    switch (builtin?.kind) {
      case 'schema':
        return builtin.schema
      case 'array':
        return { type: 'array', items: this.visitElement(builtin.items) }
      case 'set':
        return setSchema(this.visitElement(builtin.items))
      case 'map':
        return mapSchema({
          type: 'array',
          prefixItems: [this.visitElement(builtin.key), this.visitElement(builtin.value)],
          maxItems: 2,
          minItems: 2,
        })
      case 'map-entries':
        return mapSchema(builtin.entry ? this.visit(builtin.entry) : {})
    }

    return undefined
  }

  /**
   * An object type derived from an array or tuple, like type-fest's `FixedLengthArray<T, 3>`
   * (a tuple without its length mutating methods), whose values are still arrays.
   */
  private convertArrayLikeObject(properties: readonly TSSymbol[]): JsonSchema | undefined {
    const length = properties.find((p) => p.name === 'length')
    const slice = properties.find((p) => p.name === 'slice')

    if (!length || !slice || !isBuiltinSymbol(this.types, slice)) {
      return undefined
    }

    const numeric = properties.filter((p) => /^\d+$/u.test(p.name))
    // in index order, `0`, `1`, ...
    const elements = numeric.map((_, i) => numeric.find((p) => p.name === String(i)))
    const ordered = elements.every((e) => e !== undefined) ? (elements as TSSymbol[]) : numeric
    const [lengthType, ...elementTypes] = this.checker.getTypeOfSymbol([length, ...ordered])
    const fixed =
      lengthType && lengthType.flags & TypeFlags.NumberLiteral
        ? (lengthType as any).value
        : undefined

    if (fixed !== undefined && ordered === elements && numeric.length === fixed) {
      return {
        type: 'array',
        prefixItems: elementTypes.map((t) => this.visitElement(t)),
        minItems: fixed,
        maxItems: fixed,
      }
    }

    const items = dedupe(elementTypes.map((t) => this.visitElement(t)))
    return { type: 'array', items: items.length > 1 ? { anyOf: items } : (items[0] ?? {}) }
  }

  /**
   * The members of a union JSON serialization keeps, when it also has functions or symbols.
   */
  private getSerializableMembers(type: Type): readonly Type[] | undefined {
    if (!type.isUnionType()) {
      return undefined
    }

    const members = this.types.getMembers(type)
    const serializable = members.filter((m) => !isNonSerializable(this.types, m))

    return serializable.length < members.length ? serializable : undefined
  }

  /**
   * Converts some members of a union, `null` adds a `null` branch and `undefined` is left out.
   */
  private convertMembers(members: readonly Type[]): JsonSchema {
    return withNullBranch(
      this.convertUnion(members),
      members.some((m) => m.flags & TypeFlags.Null),
    )
  }

  /**
   * Array items and tuple elements serialize `undefined` as `null`.
   */
  private visitElement(type: Type | undefined): JsonSchema {
    if (!type) {
      return {}
    }

    if (type.flags & UNDEFINED_FLAGS) {
      return { type: 'null' }
    }

    // functions and symbols in arrays are serialized as `null`
    const serializable = this.getSerializableMembers(type)
    if (serializable) {
      return withNullBranch(this.convertUnion(serializable), true)
    }

    const schema = this.visit(type)

    return this.types.hasMember(type, UNDEFINED_FLAGS) &&
      !this.types.hasMember(type, TypeFlags.Null)
      ? withNull(schema)
      : schema
  }

  /**
   * `JSON.stringify` calls `toJSON` once: the returned value is serialized by its own fields,
   * so a returned `Date` is `{}`, and `this` (or `{ ...this }`) are the instance's fields.
   * Its properties and items go through `toJSON` again, so they are converted as usual.
   */
  private convertToJSONResult(type: Type): JsonSchema {
    const resolved =
      type.flags & TypeFlags.TypeParameter
        ? (this.checker.getBaseConstraintOfType(type) ?? type)
        : type

    // each member of `Date | string` or `this | null` is serialized once, by its own fields
    if (resolved.isUnionType()) {
      const members = this.types.getMembers(resolved)

      if (
        !members.some(
          (m) => m.flags & (TypeFlags.Object | TypeFlags.Intersection | TypeFlags.TypeParameter),
        )
      ) {
        return this.visit(resolved)
      }

      const schemas = dedupe(
        members.filter((m) => !(m.flags & NULLISH_FLAGS)).map((m) => this.convertToJSONResult(m)),
      )

      return withNullBranch(
        schemas.length > 1 ? { anyOf: schemas } : schemas[0],
        members.some((m) => m.flags & TypeFlags.Null),
      )
    }

    // a branded primitive (`string & { __brand: 'UserId' }`) is serialized as the primitive
    if (
      !(resolved.flags & (TypeFlags.Object | TypeFlags.Intersection)) ||
      this.types.getReferenceKind(resolved) !== undefined ||
      (resolved.isIntersectionType() &&
        this.types.getMembers(resolved).some((m) => m.flags & PRIMITIVE_FLAGS))
    ) {
      return this.visit(resolved)
    }

    const symbol = resolved.getSymbol()

    // built-ins have no own enumerable data, except typed arrays
    if (symbol && !TYPED_ARRAYS.has(symbol.name) && isBuiltinSymbol(this.types, symbol)) {
      return { type: 'object' }
    }

    return this.convertObject(resolved, true)
  }

  /**
   * Converts a value of a class instance, which `JSON.stringify` serializes. Converted again
   * under its rules only when they make a difference, so shared models keep one def.
   */
  private visitInClassInstance(type: Type): JsonSchema {
    return this.stringify || !this.sensitivity.isSensitive(type)
      ? this.visit(type)
      : this.withStringify(() => this.visit(type))
  }

  /**
   * Keys of conversion results, which differ between the serializer and `JSON.stringify`.
   */
  private key(type: Type): number {
    // a type converted the same way under both rules shares one result, and so one def
    return this.stringify && this.sensitivity.isSensitive(type) ? -type.id : type.id
  }

  private withStringify<T>(fn: () => T): T {
    const previous = this.stringify
    this.stringify = true
    try {
      return fn()
    } finally {
      this.stringify = previous
    }
  }

  private annotate(schema: JsonSchema, symbol: TSSymbol | undefined): JsonSchema {
    if (!symbol || typeof schema !== 'object') {
      return schema
    }

    const jsdoc = this.types.getJSDoc(symbol)

    return jsdoc ? applyJSDoc(schema, jsdoc.comment, jsdoc.tags) : schema
  }

  /**
   * `status?: Status` with `type Status = 'open' | null` has the type `'open' | null | undefined`,
   * which no longer carries the alias, and stripping `undefined` through the checker also strips
   * `null`. The alias type of the annotation keeps the def and its JSDoc, when it is the same type.
   */
  private getNullableAliasType(property: TSSymbol, type: Type): Type | undefined {
    if (
      !this.types.hasMember(type, UNDEFINED_FLAGS) ||
      !this.types.hasMember(type, TypeFlags.Null)
    ) {
      return undefined
    }

    const annotated = this.types.getAnnotation(property)?.type

    if (
      !annotated?.isUnionType() ||
      !this.types.hasMember(annotated, TypeFlags.Null) ||
      this.types.hasMember(annotated, UNDEFINED_FLAGS)
    ) {
      return undefined
    }

    const ids = (t: Type) =>
      new Set(
        this.types
          .getMembers(t)
          .filter((m) => !(m.flags & UNDEFINED_FLAGS))
          .map((m) => m.id),
      )
    const annotatedIds = ids(annotated)
    const typeIds = ids(type)

    // `status?: Status | 'archived'`, or a mapped type changing the value, is another type
    return annotatedIds.size === typeIds.size && [...typeIds].every((id) => annotatedIds.has(id))
      ? annotated
      : undefined
  }

  /**
   * The project type alias a property's type annotation names (`count?: Count | null`),
   * when the property still has that type: a mapped type like `{ [K in keyof T]: boolean }`
   * keeps the source declaration but not its type.
   */
  private getAnnotationAlias(property: TSSymbol, type: Type): TSSymbol | undefined {
    const annotation = this.types.getAnnotation(property)

    if (!annotation) {
      return undefined
    }

    const members = type.isUnionType() ? this.types.getMembers(type) : [type]

    return annotation.type.id === type.id || members.some((m) => m.id === annotation.type.id)
      ? annotation.alias
      : undefined
  }
}

/**
 * A schema with a `null` branch when the type has a `null` member, `{}` when nothing is left.
 */
function withNullBranch(schema: JsonSchema | undefined, hasNull: boolean): JsonSchema {
  if (!hasNull) {
    return schema ?? {}
  }

  return schema === undefined ? { type: 'null' } : withNull(schema)
}

/**
 * The key type of an index signature, the primitive or template of a branded key.
 */
function getIndexKeyType(types: TypeQueries, key: Type): Type | undefined {
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
function toPattern(types: TypeQueries, type: Type): string {
  const flags = type.flags

  if (flags & (TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BigIntLiteral)) {
    return escapeRegExp(String((type as any).value))
  }

  if (flags & TypeFlags.BooleanLiteral) {
    return String((type as any).value)
  }

  if (flags & TypeFlags.Number) {
    return '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?'
  }

  if (flags & TypeFlags.BigInt) {
    return '-?\\d+'
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

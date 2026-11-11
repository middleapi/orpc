import type { Schema as OrpcSchema } from '@orpc/contract'
import { os, type as orpcType } from '@orpc/server'
import {
  Brand,
  Chunk,
  Data,
  DateTime,
  Duration,
  Effect,
  HashMap,
  Option,
  Redacted,
  Result,
  Schema,
} from 'effect'

const typeOf = orpcType as <T>() => OrpcSchema<T, T>

/** What a client sends to each input procedure */
export const sent: Map<object, () => unknown> = new Map()

/** Of an Effect schema used for its types only: a handler returns its type, a client sends it encoded */
function schemaCase<S extends Schema.Codec<any, any>>(schema: S, sample: () => S['Type']) {
  const input = os.input(typeOf<S['Encoded']>()).handler(() => 1)
  sent.set(input, () => Schema.encodeSync(schema)(sample()))
  return {
    output: os.handler((): S['Type'] =>
      Schema.decodeUnknownSync(schema)(Schema.encodeSync(schema)(sample())),
    ),
    input,
  }
}

/** Of an Effect data type: a handler returns a value, a client holding it sends it */
function dataCase<T>(value: () => T) {
  const input = os.input(typeOf<T>()).handler(() => 1)
  sent.set(input, value)
  return { output: os.handler((): T => value()), input }
}

export enum Fruit {
  Apple = 'apple',
  Pear = 'pear',
}

export class Person extends Schema.Class<Person>('Person')({
  name: Schema.String,
  born: Schema.DateFromString,
}) {
  get label(): string {
    return this.name
  }
}

export class Circle extends Schema.TaggedClass<Circle>()('Circle', { radius: Schema.Number }) {}

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.Number }) {}

export interface Category {
  readonly name: string
  readonly children: readonly Category[]
}

const Category: Schema.Codec<Category> = Schema.Struct({
  name: Schema.String,
  children: Schema.Array(Schema.suspend(() => Category)),
})

const UserId = Schema.String.pipe(Schema.brand('UserId'))

const Account = Schema.Struct({ id: Schema.String }).pipe(Schema.brand('Account'))

export class Point extends Data.TaggedClass('Point')<{ readonly x: number }> {}

export class Pair extends Data.Class<{ readonly a: string; readonly b: number }> {}

export type Shape = Data.TaggedEnum<{ Square: { readonly side: number }; Dot: {} }>
const Shape = Data.taggedEnum<Shape>()

/** A class holding Effect values, which `JSON.stringify` writes */
export class Holder {
  option = Option.some(1)
  secret = Redacted.make('s')
  chunk = Chunk.make('a')
  point = new Point({ x: 1 })
  person = new Person({ name: 'a', born: new Date(0) })
}

export type Cents = number & Brand.Brand<'Cents'>
const Cents = Brand.nominal<Cents>()

export type Owner = { readonly id: string } & Brand.Brand<'Owner'>
const Owner = Brand.nominal<Owner>()

export const router = {
  schema: {
    struct: schemaCase(
      Schema.Struct({
        a: Schema.String,
        b: Schema.optional(Schema.Number),
        c: Schema.optionalKey(Schema.Boolean),
        d: Schema.UndefinedOr(Schema.String),
        e: Schema.NullishOr(Schema.Number),
      }),
      () => ({ a: 'x', b: undefined, d: undefined, e: null }),
    ),
    defaults: schemaCase(
      Schema.Struct({ n: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(1))) }),
      () => ({ n: 2 }),
    ),
    array: schemaCase(
      Schema.Struct({
        list: Schema.Array(Schema.Number),
        nonEmpty: Schema.NonEmptyArray(Schema.String),
        unique: Schema.UniqueArray(Schema.Number),
      }),
      () => ({ list: [1], nonEmpty: ['a'] as const, unique: [1, 2] }),
    ),
    tuple: schemaCase(
      Schema.Struct({
        pair: Schema.Tuple([Schema.String, Schema.Number]),
        optional: Schema.Tuple([Schema.String, Schema.optionalKey(Schema.Number)]),
        rest: Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number]),
      }),
      () => ({ pair: ['a', 1] as const, optional: ['a'] as const, rest: ['a', 1, 2] as const }),
    ),
    record: schemaCase(
      Schema.Struct({
        dict: Schema.Record(Schema.String, Schema.Number),
        literalKeys: Schema.Record(Schema.Literals(['a', 'b']), Schema.Number),
        withRest: Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [
          Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
        ]),
      }),
      () => ({ dict: { x: 1 }, literalKeys: { a: 1, b: 2 }, withRest: { id: 'i', n: 1 } }),
    ),
    union: schemaCase(
      Schema.Struct({
        union: Schema.Union([Schema.String, Schema.Number, Schema.Null]),
        literal: Schema.Literal('on'),
        literals: Schema.Literals(['a', 1, true]),
        enum: Schema.Enum(Fruit),
        nullOr: Schema.NullOr(Schema.Date),
      }),
      () => ({
        union: null,
        literal: 'on' as const,
        literals: 1 as const,
        enum: Fruit.Pear,
        nullOr: new Date(0),
      }),
    ),
    tagged: schemaCase(
      Schema.Struct({
        struct: Schema.TaggedStruct('A', { a: Schema.String }),
        union: Schema.TaggedUnion({ A: { a: Schema.String }, B: { b: Schema.Number } }),
        manual: Schema.Union([
          Schema.TaggedStruct('A', { a: Schema.String }),
          Schema.TaggedStruct('B', { b: Schema.Number }),
        ]),
      }),
      () => ({
        struct: { _tag: 'A' as const, a: 'x' },
        union: { _tag: 'B' as const, b: 1 },
        manual: { _tag: 'A' as const, a: 'y' },
      }),
    ),
    classes: schemaCase(Schema.Struct({ person: Person, circle: Circle, error: NotFound }), () => ({
      person: new Person({ name: 'a', born: new Date(0) }),
      circle: new Circle({ radius: 1 }),
      error: new NotFound({ id: 1 }),
    })),
    person: schemaCase(Person, () => new Person({ name: 'a', born: new Date(0) })),
    error: schemaCase(NotFound, () => new NotFound({ id: 1 })),
    dates: schemaCase(
      Schema.Struct({
        date: Schema.Date,
        fromString: Schema.DateFromString,
        utc: Schema.DateTimeUtc,
        utcFromString: Schema.DateTimeUtcFromString,
        utcFromMillis: Schema.DateTimeUtcFromMillis,
      }),
      () => ({
        date: new Date(0),
        fromString: new Date(0),
        utc: DateTime.makeUnsafe(0),
        utcFromString: DateTime.makeUnsafe(0),
        utcFromMillis: DateTime.makeUnsafe(0),
      }),
    ),
    bigints: schemaCase(
      Schema.Struct({ bigint: Schema.BigInt, fromString: Schema.BigIntFromString }),
      () => ({ bigint: 1n, fromString: 2n }),
    ),
    options: schemaCase(
      Schema.Struct({
        some: Schema.Option(Schema.Number),
        none: Schema.Option(Schema.Number),
        fromNullOr: Schema.OptionFromNullOr(Schema.String),
        fromNullOrNone: Schema.OptionFromNullOr(Schema.String),
        fromOptional: Schema.OptionFromOptional(Schema.Number),
      }),
      () => ({
        some: Option.some(1),
        none: Option.none(),
        fromNullOr: Option.some('a'),
        fromNullOrNone: Option.none(),
        fromOptional: Option.none(),
      }),
    ),
    results: schemaCase(
      Schema.Struct({
        success: Schema.Result(Schema.Number, Schema.String),
        failure: Schema.Result(Schema.Number, Schema.String),
      }),
      () => ({ success: Result.succeed(1), failure: Result.fail('e') }),
    ),
    brand: schemaCase(
      Schema.Struct({ id: UserId, ids: Schema.Array(UserId), account: Account }),
      () => ({ id: UserId.make('u'), ids: [UserId.make('v')], account: Account.make({ id: 'a' }) }),
    ),
    redacted: schemaCase(
      Schema.Struct({
        redacted: Schema.Redacted(Schema.String),
        fromValue: Schema.RedactedFromValue(Schema.String),
      }),
      () => ({ redacted: Redacted.make('s'), fromValue: Redacted.make('t') }),
    ),
    duration: schemaCase(
      Schema.Struct({ duration: Schema.Duration, fromMillis: Schema.DurationFromMillis }),
      () => ({ duration: Duration.millis(5), fromMillis: Duration.seconds(1) }),
    ),
    transformations: schemaCase(
      Schema.Struct({
        number: Schema.NumberFromString,
        trim: Schema.Trim,
        bit: Schema.BooleanFromBit,
        json: Schema.fromJsonString(Schema.Struct({ a: Schema.Number })),
        url: Schema.URLFromString,
        bytes: Schema.Uint8ArrayFromBase64,
        composed: Schema.String.pipe(Schema.decodeTo(Schema.NumberFromString)),
      }),
      () => ({
        number: 1,
        trim: 'a',
        bit: true,
        json: { a: 1 },
        url: new URL('https://example.com/'),
        bytes: new Uint8Array([1, 2]),
        composed: 3,
      }),
    ),
    collections: schemaCase(
      Schema.Struct({
        map: Schema.ReadonlyMap(Schema.String, Schema.Number),
        set: Schema.ReadonlySet(Schema.String),
        chunk: Schema.Chunk(Schema.Number),
        hashMap: Schema.HashMap(Schema.String, Schema.Number),
      }),
      () => ({
        map: new Map([['a', 1]]),
        set: new Set(['a']),
        chunk: Chunk.make(1, 2),
        hashMap: HashMap.make(['a', 1]),
      }),
    ),
    recursion: schemaCase(Category, () => ({
      name: 'a',
      children: [{ name: 'b', children: [] }],
    })),
  },
  data: {
    option: dataCase(() => ({ some: Option.some(1), none: Option.none<number>() })),
    optionRoot: dataCase(() => Option.some({ at: new Date(0) })),
    result: dataCase(() => ({
      success: Result.succeed(1) as Result.Result<number, string>,
      failure: Result.fail('e') as Result.Result<number, string>,
    })),
    taggedClass: dataCase(() => new Point({ x: 1 })),
    dataClass: dataCase(() => ({ pair: new Pair({ a: 'a', b: 1 }) })),
    brand: dataCase(() => ({ cents: Cents(100), owner: Owner({ id: 'o' }) })),
    brandRoot: dataCase(() => Owner({ id: 'o' })),
    chunk: dataCase(() => Chunk.make(1, 2)),
    hashMap: dataCase(() => HashMap.make(['a', 1])),
    dateTime: dataCase(() => ({
      utc: DateTime.makeUnsafe(0),
      zoned: DateTime.makeZonedUnsafe(0, { timeZone: 'Europe/Paris' }),
    })),
    duration: dataCase(() => Duration.millis(5)),
    redacted: dataCase(() => Redacted.make('s')),
    taggedEnum: dataCase(() => [Shape.Square({ side: 1 }), Shape.Dot()]),
    holder: dataCase(() => new Holder()),
    readonlyHolder: dataCase((): Readonly<Holder> => new Holder()),
  },
}

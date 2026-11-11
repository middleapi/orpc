import type { AnySchema, Schema } from '@orpc/contract'
import { os, type as orpcType } from '@orpc/server'
import { scope, type } from 'arktype'
import * as v from 'valibot'
import * as z from 'zod'

/** Schemas of schema libraries used for their types only, each with a value a client sends */
export const samples: Record<string, { schema: AnySchema; sample: () => unknown }> = {}

const typeOf = orpcType as <T>() => Schema<T, T>

/** The value a handler returns, a client sends, and a client holding the parsed value sends */
function procedures<TIn, TOut>(name: string, schema: AnySchema, sample: () => unknown) {
  samples[name] = { schema, sample }
  return {
    output: os.handler(
      async (): Promise<TOut> => ((await schema['~standard'].validate(sample())) as any).value,
    ),
    input: os.input(typeOf<TIn>()).handler(() => 1),
    parsed: os.input(typeOf<TOut>()).handler(() => 1),
  }
}

const zodCase = <S extends z.ZodType>(name: string, schema: S, sample: () => unknown) =>
  procedures<z.input<S>, z.infer<S>>(`zod/${name}`, schema, sample)

const valibotCase = <S extends v.GenericSchema>(name: string, schema: S, sample: () => unknown) =>
  procedures<v.InferInput<S>, v.InferOutput<S>>(`valibot/${name}`, schema, sample)

const arktypeCase = <S extends type.Any>(name: string, schema: S, sample: () => unknown) =>
  procedures<S['inferIn'], S['infer']>(`arktype/${name}`, schema, sample)

export enum Color {
  Red = 'red',
  Green = 'green',
}

const ZodNode = z.object({
  name: z.string(),
  get children() {
    return z.array(ZodNode)
  },
})

export interface Category {
  name: string
  children: Category[]
}

const ValibotCategory: v.GenericSchema<Category> = v.object({
  name: v.string(),
  children: v.array(v.lazy(() => ValibotCategory)),
})

const arkNodes = scope({ node: { name: 'string', children: 'node[]' } }).export()

const tree = () => ({ name: 'a', children: [{ name: 'b', children: [] }] })

export const router = {
  zod: {
    object: zodCase('object', z.object({ a: z.string(), b: z.number().optional() }), () => ({
      a: 'x',
    })),
    looseObject: zodCase('looseObject', z.looseObject({ a: z.string() }), () => ({
      a: 'x',
      extra: 1,
    })),
    catchall: zodCase('catchall', z.object({ a: z.string() }).catchall(z.number()), () => ({
      a: 'x',
      n: 1,
    })),
    tuple: zodCase('tuple', z.tuple([z.string(), z.number().optional()], z.boolean()), () => [
      'a',
      1,
      true,
    ]),
    collections: zodCase(
      'collections',
      z.object({ set: z.set(z.string()), map: z.map(z.string(), z.date()) }),
      () => ({ set: new Set(['a']), map: new Map([['a', new Date(0)]]) }),
    ),
    record: zodCase('record', z.partialRecord(z.enum(['a', 'b']), z.number()), () => ({ a: 1 })),
    discriminatedUnion: zodCase(
      'discriminatedUnion',
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), a: z.string() }),
        z.object({ kind: z.literal('b'), b: z.bigint() }),
      ]),
      () => ({ kind: 'b', b: 1n }),
    ),
    intersection: zodCase(
      'intersection',
      z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
      () => ({ a: 'x', b: 1 }),
    ),
    enums: zodCase(
      'enums',
      z.object({ e: z.enum(['a', 'b']), n: z.enum(Color), l: z.literal(['x', 1]) }),
      () => ({ e: 'a', n: Color.Red, l: 1 }),
    ),
    modifiers: zodCase(
      'modifiers',
      z.object({
        nullable: z.string().nullable(),
        nullish: z.string().nullish(),
        default: z.string().default('d'),
        catch: z.number().catch(0),
        readonly: z.array(z.string()).readonly(),
        brand: z.string().brand<'Id'>(),
      }),
      () => ({ nullable: null, nullish: undefined, catch: 1, readonly: ['x'], brand: 'id' }),
    ),
    transforms: zodCase(
      'transforms',
      z.object({
        transform: z.string().transform((s) => s.length),
        pipe: z.string().pipe(z.coerce.number()),
        preprocess: z.preprocess((value) => String(value), z.string()),
        coerce: z.coerce.date(),
        stringbool: z.stringbool(),
        codec: z.codec(z.iso.datetime(), z.date(), {
          decode: (s) => new Date(s),
          encode: (d) => d.toISOString(),
        }),
      }),
      () => ({
        transform: 'abc',
        pipe: '12',
        preprocess: 1,
        coerce: '1970-01-01T00:00:00.000Z',
        stringbool: 'true',
        codec: '1970-01-01T00:00:00.000Z',
      }),
    ),
    recursion: zodCase('recursion', ZodNode, tree),
    natives: zodCase(
      'natives',
      z.object({
        date: z.date(),
        bigint: z.bigint(),
        symbol: z.symbol(),
        undefined: z.undefined(),
        any: z.any(),
        unknown: z.unknown(),
        never: z.never().optional(),
        url: z.instanceof(URL),
      }),
      () => ({
        date: new Date(0),
        bigint: 1n,
        symbol: Symbol('s'),
        undefined: undefined,
        any: 1,
        unknown: 'x',
        url: new URL('http://x/'),
      }),
    ),
    strings: zodCase(
      'strings',
      z.object({
        email: z.email(),
        uuid: z.uuid(),
        datetime: z.iso.datetime(),
        template: z.templateLiteral(['id-', z.number()]),
      }),
      () => ({
        email: 'a@b.co',
        uuid: '00000000-0000-4000-8000-000000000000',
        datetime: '1970-01-01T00:00:00Z',
        template: 'id-1',
      }),
    ),
    json: zodCase('json', z.json(), () => ({ a: [1, 'x', null, true, { b: {} }] })),
    file: zodCase('file', z.file(), () => new File(['x'], 'a.txt', { type: 'text/plain' })),
  },
  valibot: {
    object: valibotCase(
      'object',
      v.object({ a: v.string(), b: v.optional(v.number()), c: v.exactOptional(v.boolean()) }),
      () => ({ a: 'x' }),
    ),
    objectWithRest: valibotCase(
      'objectWithRest',
      v.objectWithRest({ a: v.string() }, v.number()),
      () => ({
        a: 'x',
        n: 1,
      }),
    ),
    tupleWithRest: valibotCase('tupleWithRest', v.tupleWithRest([v.string()], v.number()), () => [
      'a',
      1,
      2,
    ]),
    collections: valibotCase(
      'collections',
      v.object({ set: v.set(v.date()), map: v.map(v.string(), v.bigint()) }),
      () => ({ set: new Set([new Date(0)]), map: new Map([['a', 1n]]) }),
    ),
    variant: valibotCase(
      'variant',
      v.variant('kind', [
        v.object({ kind: v.literal('a'), a: v.string() }),
        v.object({ kind: v.literal('b'), b: v.number() }),
      ]),
      () => ({ kind: 'b', b: 1 }),
    ),
    enums: valibotCase('enums', v.object({ p: v.picklist(['a', 'b']), e: v.enum(Color) }), () => ({
      p: 'a',
      e: Color.Green,
    })),
    modifiers: valibotCase(
      'modifiers',
      v.object({
        default: v.optional(v.string(), 'd'),
        nullish: v.nullish(v.string()),
        undefinedable: v.undefinedable(v.string()),
        fallback: v.fallback(v.number(), 0),
        brand: v.pipe(v.string(), v.brand('Id')),
      }),
      () => ({ nullish: null, undefinedable: undefined, fallback: 1, brand: 'id' }),
    ),
    transforms: valibotCase(
      'transforms',
      v.object({
        length: v.pipe(
          v.string(),
          v.transform((s) => s.length),
        ),
        date: v.pipe(v.string(), v.isoTimestamp(), v.toDate()),
      }),
      () => ({ length: 'abc', date: '1970-01-01T00:00:00.000Z' }),
    ),
    recursion: valibotCase('recursion', ValibotCategory, tree),
  },
  arktype: {
    object: arktypeCase(
      'object',
      type({ 'a': 'string', 'b?': 'number', '[string]': 'unknown' }),
      () => ({
        a: 'x',
        extra: 1,
      }),
    ),
    tuple: arktypeCase('tuple', type(['string', '...', 'number[]']), () => ['a', 1, 2]),
    discriminated: arktypeCase(
      'discriminated',
      type({ kind: "'a'", at: 'Date' }).or({ kind: "'b'", n: 'bigint' }),
      () => ({ kind: 'b', n: 1n }),
    ),
    enums: arktypeCase(
      'enums',
      type({ e: type.enumerated('a', 'b'), n: type.valueOf(Color) }),
      () => ({
        e: 'a',
        n: Color.Red,
      }),
    ),
    modifiers: arktypeCase(
      'modifiers',
      type({ default: 'string = "d"', nullable: 'string | null', brand: 'string#Id' }),
      () => ({ nullable: null, brand: 'id' }),
    ),
    brandedObject: arktypeCase('brandedObject', type({ id: 'string' }).brand('User'), () => ({
      id: 'u',
    })),
    morphs: arktypeCase(
      'morphs',
      type({
        length: type('string').pipe((s) => s.length),
        number: 'string.numeric.parse',
        date: 'string.date.iso.parse',
      }),
      () => ({ length: 'abc', number: '12', date: '1970-01-01T00:00:00.000Z' }),
    ),
    recursion: arktypeCase('recursion', arkNodes.node, tree),
    natives: arktypeCase(
      'natives',
      type({ date: 'Date', bigint: 'bigint', url: type.instanceOf(URL), email: 'string.email' }),
      () => ({ date: new Date(0), bigint: 1n, url: new URL('http://x/'), email: 'a@b.co' }),
    ),
  },
}

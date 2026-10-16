import { getHiddenMetaPlugins, setHiddenMetaPlugins } from '@orpc/contract'
import { Effect, Schema, SchemaTransformation } from 'effect'
import { toStandardSchema } from './schema'

const NumberFromString = Schema.String.pipe(Schema.decodeTo(Schema.Number, SchemaTransformation.transform({
  decode: Number,
  encode: String,
})))

const AsyncNumberFromString = Schema.String.pipe(Schema.decodeTo(Schema.Number, SchemaTransformation.transformEffect({
  decode: s => Effect.promise(async () => Number(s)),
  encode: n => Effect.succeed(String(n)),
})))

describe('toStandardSchema', () => {
  it('convert to standard schema', () => {
    const converted = toStandardSchema(Schema.Number)

    expect(converted['~standard'].vendor).toBe('effect')
    expect(converted['~standard'].version).toBe(1)
    expect(Schema.isSchema(converted)).toBe(true)
    expect(converted.ast).toBe(Schema.Number.ast)
  })

  it('does not mutate the original schema', () => {
    const converted = toStandardSchema(Schema.String)

    expect(converted).not.toBe(Schema.String)
    expect(Object.hasOwn(Schema.String, '~standard')).toBe(false)
  })

  it('keeps schema specific members', () => {
    const schema = Schema.Struct({ a: Schema.String })

    expect(toStandardSchema(schema).fields).toBe(schema.fields)
  })

  it('keep meta plugins', () => {
    const schema = Schema.Struct({ a: Schema.Number })
    const plugin = { name: 'plugin1' }
    setHiddenMetaPlugins(schema, [plugin])

    const converted = toStandardSchema(schema)
    expect(converted['~standard'].vendor).toBe('effect')
    expect(getHiddenMetaPlugins(converted)).toEqual([plugin])
  })

  it('keeps other standard schema props', () => {
    const schema = Schema.toStandardJSONSchemaV1(Schema.Struct({ a: Schema.Number }))
    const converted = toStandardSchema(schema)

    expect(converted['~standard'].jsonSchema).toBe(schema['~standard'].jsonSchema)
    expect(converted['~standard'].validate({ a: 1 })).toEqual({ value: { a: 1 } })
  })

  it('replaces validate attached by Schema.toStandardSchemaV1', () => {
    const schema = Schema.toStandardSchemaV1(Schema.Struct({ a: NumberFromString }), {
      leafHook: () => 'from effect',
    })
    const converted = toStandardSchema(schema)

    expect(converted['~standard'].validate).not.toBe(schema['~standard'].validate)
    expect(converted['~standard'].validate({})).toEqual({
      issues: [{ path: ['a'], message: 'Missing key' }],
    })
  })

  describe('validate', () => {
    const schema = toStandardSchema(Schema.Struct({ a: NumberFromString, b: Schema.String }))

    it('success', () => {
      expect(schema['~standard'].validate({ a: '1', b: 'b' })).toEqual({ value: { a: 1, b: 'b' } })
    })

    it('reports all issues', () => {
      expect(schema['~standard'].validate({ a: 1 })).toEqual({
        issues: [
          { path: ['a'], message: 'Expected string' },
          { path: ['b'], message: 'Missing key' },
        ],
      })
    })

    it('async', async () => {
      const schema = toStandardSchema(Schema.Struct({ a: AsyncNumberFromString }))

      const success = schema['~standard'].validate({ a: '1' })
      expect(success).toBeInstanceOf(Promise)
      await expect(success).resolves.toEqual({ value: { a: 1 } })

      expect(await schema['~standard'].validate({ a: 1 })).toEqual({
        issues: [{ path: ['a'], message: 'Expected string' }],
      })
    })

    describe('throws defects instead of reporting them as issues', () => {
      const error = new Error('connection string postgres://admin:hunter2@db')

      it('transformation', () => {
        const schema = toStandardSchema(Schema.Struct({
          a: Schema.String.pipe(Schema.decodeTo(Schema.Number, SchemaTransformation.transform({
            decode: () => { throw error },
            encode: String,
          }))),
        }))

        expect(() => schema['~standard'].validate({ a: '1' })).toThrow(error)
      })

      it('check', () => {
        const schema = toStandardSchema(Schema.Struct({
          a: Schema.String.check(Schema.makeFilter(() => { throw error })),
        }))

        expect(() => schema['~standard'].validate({ a: '1' })).toThrow(error)
      })

      it('async', async () => {
        const schema = toStandardSchema(Schema.Struct({
          a: Schema.String.pipe(Schema.decodeTo(Schema.Number, SchemaTransformation.transformEffect<number, string>({
            decode: () => Effect.promise(async () => { throw error }),
            encode: n => Effect.succeed(String(n)),
          }))),
        }))

        await expect(schema['~standard'].validate({ a: '1' })).rejects.toBe(error)
      })

      it('interruption', async () => {
        const schema = toStandardSchema(Schema.String.pipe(Schema.decodeTo(Schema.Number, SchemaTransformation.transformEffect<number, string>({
          decode: () => Effect.interrupt,
          encode: n => Effect.succeed(String(n)),
        }))))

        expect(() => schema['~standard'].validate('1')).toThrow()
      })
    })
  })
})

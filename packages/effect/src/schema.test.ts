import { getHiddenMetaPlugins, setHiddenMetaPlugins } from '@orpc/contract'
import { Option, Schema } from 'effect'
import { toStandardOutputSchema, toStandardSchema } from './schema'

const Codec = Schema.Struct({
  count: Schema.NumberFromString,
  maybe: Schema.OptionFromNullOr(Schema.String),
})

describe('toStandardSchema', () => {
  it('convert to standard schema', () => {
    expect(toStandardSchema(Schema.Number)['~standard'].vendor).toBe('effect')
  })

  it('decodes', () => {
    const converted = toStandardSchema(Codec)

    expect(converted['~standard'].validate({ count: '5', maybe: 'x' })).toEqual({ value: { count: 5, maybe: Option.some('x') } })
    expect(converted['~standard'].validate({ count: 5, maybe: Option.some('x') })).toEqual({ issues: expect.any(Array) })
  })

  it('keep meta plugins', () => {
    const schema = Schema.Number
    const plugin = { name: 'plugin1' }
    setHiddenMetaPlugins(schema, [plugin])

    const converted = toStandardSchema(schema)
    expect(converted['~standard'].vendor).toBe('effect')
    expect(getHiddenMetaPlugins(converted)).toEqual([plugin])
  })
})

describe('toStandardOutputSchema', () => {
  it('convert to standard schema', () => {
    expect(toStandardOutputSchema(Schema.Number)['~standard'].vendor).toBe('effect')
  })

  it('encodes', () => {
    const converted = toStandardOutputSchema(Codec)

    expect(converted['~standard'].validate({ count: 5, maybe: Option.some('x') })).toEqual({ value: { count: '5', maybe: 'x' } })
    expect(converted['~standard'].validate({ count: 5, maybe: Option.none() })).toEqual({ value: { count: '5', maybe: null } })
    expect(converted['~standard'].validate({ count: '5', maybe: 'x' })).toEqual({ issues: expect.any(Array) })
  })

  it('keep meta plugins', () => {
    // `annotate` returns a fresh instance, so the shared `Schema.String` is left untouched
    const schema = Schema.String.annotate({})
    const plugin = { name: 'plugin1' }
    setHiddenMetaPlugins(schema, [plugin])

    const converted = toStandardOutputSchema(schema)
    expect(converted['~standard'].vendor).toBe('effect')
    expect(getHiddenMetaPlugins(converted)).toEqual([plugin])
  })
})

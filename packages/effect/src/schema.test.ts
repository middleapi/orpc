import { getHiddenMetaPlugins, setHiddenMetaPlugins } from '@orpc/contract'
import { Schema } from 'effect'
import { toOutputStandardSchema, toStandardSchema } from './schema'

describe('toStandardSchema', () => {
  it('convert to standard schema', () => {
    expect(toStandardSchema(Schema.Number)['~standard'].vendor).toBe('effect')
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

describe('toOutputStandardSchema', () => {
  it('validates by encoding', async () => {
    const schema = toOutputStandardSchema(Schema.NumberFromString)

    expect(schema['~standard'].vendor).toBe('effect')
    expect(await schema['~standard'].validate(42)).toEqual({ value: '42' })
    expect(await schema['~standard'].validate('42')).toHaveProperty('issues')
  })

  it('keeps each direction when the same schema is also converted for input', async () => {
    const schema = Schema.Struct({ n: Schema.NumberFromString })

    expect(await toStandardSchema(schema)['~standard'].validate({ n: '42' })).toEqual({ value: { n: 42 } })
    expect(await toOutputStandardSchema(schema)['~standard'].validate({ n: 42 })).toEqual({ value: { n: '42' } })
  })

  it('returns one instance per schema', () => {
    const schema = Schema.Struct({ n: Schema.Number })

    expect(toOutputStandardSchema(schema)).toBe(toOutputStandardSchema(schema))
  })

  it('keep meta plugins', () => {
    const schema = Schema.Number.annotate({})
    const plugin = { name: 'plugin1' }
    setHiddenMetaPlugins(schema, [plugin])

    expect(getHiddenMetaPlugins(toOutputStandardSchema(schema))).toEqual([plugin])
  })
})

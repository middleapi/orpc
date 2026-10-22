import type { OpenRPCMethodObject } from './types'
import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { getOpenRPCMeta, openrpc } from './meta'

describe('openrpc meta', () => {
  it('returns a plugin with name ~openrpc', () => {
    expect(openrpc({ summary: 'Find a planet' }).name).toBe('~openrpc')
  })

  it('init meta on first time use', () => {
    const meta = {
      summary: 'Find a planet',
      description: 'Finds a planet by id',
      deprecated: true,
      tags: ['planets'],
      externalDocs: { url: 'https://example.com/planets' },
      examples: [{ name: 'earth', input: { id: 1 }, output: { name: 'Earth' } }],
    }

    expect(getOpenRPCMeta(oc.meta(openrpc(meta)))).toEqual(meta)
    expect(getOpenRPCMeta(os.meta(openrpc(meta)))).toEqual(meta)
    expect(getOpenRPCMeta(os.meta(openrpc(meta)).handler(() => {}))).toEqual(meta)
  })

  it('returns undefined when meta is not set', () => {
    expect(getOpenRPCMeta(oc)).toBeUndefined()
    expect(getOpenRPCMeta(os.handler(() => {}))).toBeUndefined()
  })

  it('reads meta from lazy routers', () => {
    const lazy = os.meta(openrpc({ tags: ['planets'] })).lazy(() => Promise.resolve({ default: {} }))

    expect(getOpenRPCMeta(lazy)).toEqual({ tags: ['planets'] })
  })

  it('prioritizes later calls and keeps fields they omit', () => {
    const contract = oc
      .meta(openrpc({ summary: 'First', description: 'Kept', deprecated: true, externalDocs: { url: 'https://a.example' } }))
      .meta(openrpc({ summary: 'Second', deprecated: false }))

    expect(getOpenRPCMeta(contract)).toEqual({
      summary: 'Second',
      description: 'Kept',
      deprecated: false,
      externalDocs: { url: 'https://a.example' },
    })
  })

  describe('tags merging', () => {
    it('concatenates tags from multiple calls', () => {
      const contract = oc.meta(openrpc({ tags: ['a'] })).meta(openrpc({ tags: ['b', 'c'] }))

      expect(getOpenRPCMeta(contract)?.tags).toEqual(['a', 'b', 'c'])
    })

    it('keeps existing tags when a later call omits them', () => {
      expect(getOpenRPCMeta(oc.meta(openrpc({ tags: ['a'] })).meta(openrpc({})))?.tags).toEqual(['a'])
      expect(getOpenRPCMeta(oc.meta(openrpc({})).meta(openrpc({ tags: ['b'] })))?.tags).toEqual(['b'])
    })

    it('resets tags when explicitly set to undefined', () => {
      expect(getOpenRPCMeta(oc.meta(openrpc({ tags: ['a'] })).meta(openrpc({ tags: undefined })))?.tags).toBeUndefined()
    })
  })

  describe('examples merging', () => {
    it('replaces examples instead of merging them', () => {
      const contract = oc
        .meta(openrpc({ examples: [{ name: 'first', input: 1 }] }))
        .meta(openrpc({ examples: [{ name: 'second', input: 2 }] }))

      expect(getOpenRPCMeta(contract)?.examples).toEqual([{ name: 'second', input: 2 }])
    })

    it('keeps examples when a later call omits them, and resets them on undefined', () => {
      const contract = oc.meta(openrpc({ examples: [{ name: 'first' }] }))

      expect(getOpenRPCMeta(contract.meta(openrpc({})))?.examples).toEqual([{ name: 'first' }])
      expect(getOpenRPCMeta(contract.meta(openrpc({ examples: undefined })))?.examples).toBeUndefined()
    })
  })

  describe('spec merging', () => {
    const current: OpenRPCMethodObject = { name: 'planet.find', params: [] }

    it('uses the incoming spec when no spec exists', () => {
      const spec = { name: 'planet.find', params: [] }

      expect(getOpenRPCMeta(oc.meta(openrpc({ spec })))?.spec).toBe(spec)
    })

    it('keeps the existing spec when a later call omits it', () => {
      const spec = { name: 'planet.find', params: [] }

      expect(getOpenRPCMeta(oc.meta(openrpc({ spec })).meta(openrpc({ summary: 'x' })))?.spec).toBe(spec)
    })

    it('chains two function specs: existing applied first, then incoming', () => {
      const contract = oc
        .meta(openrpc({ spec: method => ({ ...method, summary: 'first', description: 'first' }) }))
        .meta(openrpc({ spec: method => ({ ...method, summary: 'second' }) }))

      const spec = getOpenRPCMeta(contract)?.spec

      expect(typeof spec).toBe('function')
      expect((spec as (method: OpenRPCMethodObject) => OpenRPCMethodObject)(current)).toEqual({
        name: 'planet.find',
        params: [],
        summary: 'second',
        description: 'first',
      })
    })

    it('applies an existing function spec to an incoming object spec eagerly', () => {
      const contract = oc
        .meta(openrpc({ spec: method => ({ ...method, summary: 'from function' }) }))
        .meta(openrpc({ spec: { name: 'override', params: [] } }))

      expect(getOpenRPCMeta(contract)?.spec).toEqual({ name: 'override', params: [], summary: 'from function' })
    })

    it('applies an incoming function spec to an existing object spec eagerly', () => {
      const contract = oc
        .meta(openrpc({ spec: { name: 'base', params: [] } }))
        .meta(openrpc({ spec: method => ({ ...method, deprecated: true }) }))

      expect(getOpenRPCMeta(contract)?.spec).toEqual({ name: 'base', params: [], deprecated: true })
    })

    it('lets the most recent object spec win', () => {
      const contract = oc
        .meta(openrpc({ spec: { name: 'first', params: [] } }))
        .meta(openrpc({ spec: { name: 'second', params: [] } }))

      expect(getOpenRPCMeta(contract)?.spec).toEqual({ name: 'second', params: [] })
    })

    it('resets the spec when explicitly set to undefined', () => {
      const contract = oc
        .meta(openrpc({ spec: { name: 'first', params: [] } }))
        .meta(openrpc({ spec: undefined }))

      expect(getOpenRPCMeta(contract)?.spec).toBeUndefined()
    })
  })

  it('resets every field when set to undefined in a later call', () => {
    const contract = oc
      .meta(openrpc({
        summary: 'summary',
        description: 'description',
        deprecated: true,
        tags: ['a'],
        externalDocs: { url: 'https://example.com' },
        examples: [{ name: 'example' }],
        spec: method => method,
      }))
      .meta(openrpc({
        summary: undefined,
        description: undefined,
        deprecated: undefined,
        tags: undefined,
        externalDocs: undefined,
        examples: undefined,
        spec: undefined,
      }))

    expect(getOpenRPCMeta(contract)).toEqual({})
  })

  it('does not touch other meta', () => {
    const contract = oc.meta({ name: 'custom', init: meta => ({ ...meta, custom: true }) }).meta(openrpc({ summary: 'x' }))

    expect(contract['~orpc'].meta).toEqual({ 'custom': true, '~openrpc': { summary: 'x' } })
  })
})

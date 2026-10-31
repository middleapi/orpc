import { oc } from '@orpc/contract'
import { getOpenAPIMeta, openapi } from '@orpc/openapi'
import { os } from '@orpc/server'
import { getOpenRPCMeta, openrpc } from './meta'

describe('openrpc meta', () => {
  describe('openrpc() function', () => {
    it('returns a plugin with name ~openrpc', () => {
      expect(openrpc({ summary: 'Find a planet' }).name).toBe('~openrpc')
    })

    it('init meta on first time use', () => {
      const meta = { summary: 'Find a planet', tags: ['planets'], examples: [{ name: 'earth', input: { id: 1 } }] }
      expect(getOpenRPCMeta(oc.meta(openrpc(meta)))).toEqual(meta)
    })

    it('prioritize later call and keeps fields it omits', () => {
      const procedure = oc
        .meta(openrpc({ summary: 'First', description: 'Kept', examples: [{ name: 'first' }] }))
        .meta(openrpc({ summary: 'Second', examples: [{ name: 'second' }] }))
      expect(getOpenRPCMeta(procedure)).toMatchObject({
        summary: 'Second',
        description: 'Kept',
        examples: [{ name: 'second' }],
      })
    })

    it('does not touch openapi meta', () => {
      const procedure = oc.meta(openapi({ summary: 'OpenAPI' })).meta(openrpc({ summary: 'OpenRPC' }))
      expect(getOpenAPIMeta(procedure)).toEqual({ summary: 'OpenAPI' })
      expect(getOpenRPCMeta(procedure)).toMatchObject({ summary: 'OpenRPC' })
    })

    describe('tags merging', () => {
      it('concatenates tags from multiple calls', () => {
        const procedure = oc
          .meta(openrpc({ tags: ['existing-tag'] }))
          .meta(openrpc({ tags: ['new-tag'] }))
        expect(getOpenRPCMeta(procedure)?.tags).toEqual(['existing-tag', 'new-tag'])
      })

      it('uses only existing tags when no incoming tags', () => {
        const procedure = oc
          .meta(openrpc({ tags: ['existing'] }))
          .meta(openrpc({}))
        expect(getOpenRPCMeta(procedure)?.tags).toEqual(['existing'])
      })
    })

    describe('spec merging', () => {
      it('uses existing object spec when no incoming spec', () => {
        const existingSpec = { name: 'find', params: [] }
        const procedure = oc
          .meta(openrpc({ spec: existingSpec }))
          .meta(openrpc({}))
        expect(getOpenRPCMeta(procedure)?.spec).toBe(existingSpec)
      })

      it('prioritizes the later object spec', () => {
        const procedure = oc
          .meta(openrpc({ spec: { name: 'first', params: [] } }))
          .meta(openrpc({ spec: { name: 'second', params: [] } }))
        expect(getOpenRPCMeta(procedure)?.spec).toEqual({ name: 'second', params: [] })
      })

      it('composes two function specs: existing applied first, then incoming', () => {
        const procedure = oc
          .meta(openrpc({ spec: current => ({ ...current, 'x-a': 1, 'x-order': 1 }) }))
          .meta(openrpc({ spec: current => ({ ...current, 'x-b': 2, 'x-order': 2 }) }))
        const spec = getOpenRPCMeta(procedure)?.spec as any
        expect(spec({ name: 'find', params: [] })).toEqual({ 'name': 'find', 'params': [], 'x-a': 1, 'x-b': 2, 'x-order': 2 })
      })

      it('resolves existing function spec with incoming object spec eagerly', () => {
        const procedure = oc
          .meta(openrpc({ spec: current => ({ ...current, 'x-existing': true }) }))
          .meta(openrpc({ spec: { name: 'override', params: [] } }))
        expect(getOpenRPCMeta(procedure)?.spec).toEqual({ 'name': 'override', 'params': [], 'x-existing': true })
      })

      it('applies incoming function spec to existing object spec eagerly', () => {
        const procedure = oc
          .meta(openrpc({ spec: { name: 'base', params: [] } }))
          .meta(openrpc({ spec: current => ({ ...current, 'x-extra': true }) }))
        expect(getOpenRPCMeta(procedure)?.spec).toEqual({ 'name': 'base', 'params': [], 'x-extra': true })
      })
    })

    it('metadata resets to its default behavior when set to `undefined` in subsequent calls', () => {
      const procedure = oc
        .meta(openrpc({
          summary: 'Find a planet',
          description: 'des',
          deprecated: true,
          tags: ['a', 'b'],
          externalDocs: { url: 'https://example.com' },
          examples: [{ name: 'earth' }],
          spec: current => current,
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

      expect(getOpenRPCMeta(procedure)).toEqual({})
    })
  })

  describe('getOpenRPCMeta', () => {
    it('returns undefined when no openrpc meta has been applied', () => {
      expect(getOpenRPCMeta(oc)).toBeUndefined()
    })

    it('returns the ~openrpc meta from contracts, procedures and lazy routers', () => {
      expect(getOpenRPCMeta(oc.meta(openrpc({ summary: 'contract' })))).toEqual({ summary: 'contract' })
      expect(getOpenRPCMeta(os.meta(openrpc({ summary: 'procedure' })).handler(() => {}))).toMatchObject({ summary: 'procedure' })
      expect(getOpenRPCMeta(os.meta(openrpc({ summary: 'lazy' })).lazy(() => Promise.resolve({ default: {} })))).toMatchObject({ summary: 'lazy' })
    })
  })
})

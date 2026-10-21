import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { getMcpToolMeta, mcp } from './meta'

describe('mcp.tool meta', () => {
  it('returns a plugin with name ~mcp/tool', () => {
    expect(mcp.tool({ name: 'get_planet' }).name).toBe('~mcp/tool')
  })

  it('init meta on first time use', () => {
    const meta = { name: 'get_planet', description: 'Get a planet', annotations: { readOnlyHint: true } }
    expect(getMcpToolMeta(oc.meta(mcp.tool(meta)))).toEqual(meta)
    expect(getMcpToolMeta(os.meta(mcp.tool(meta)))).toEqual(meta)
  })

  it('returns undefined when meta is not set', () => {
    expect(getMcpToolMeta(oc)).toBeUndefined()
  })

  it('reads meta from lazy routers', () => {
    const lazy = os.meta(mcp.tool({ title: 'Planets' })).lazy(() => Promise.resolve({ default: {} }))
    expect(getMcpToolMeta(lazy)).toEqual({ title: 'Planets' })
  })

  it('overrides fields with the most recent call, but merges annotations', () => {
    const contract = oc
      .meta(mcp.tool({ name: 'first', title: 'First', _meta: { a: 1 }, annotations: { readOnlyHint: true, openWorldHint: true } }))
      .meta(mcp.tool({ name: 'second', _meta: { b: 2 }, annotations: { openWorldHint: false } }))

    expect(getMcpToolMeta(contract)).toEqual({
      name: 'second',
      title: 'First',
      _meta: { b: 2 },
      annotations: { readOnlyHint: true, openWorldHint: false },
    })
  })

  it('keeps or resets annotations when only one call defines them', () => {
    expect(getMcpToolMeta(
      oc.meta(mcp.tool({ annotations: { readOnlyHint: true } })).meta(mcp.tool({ name: 'name' })),
    )?.annotations).toEqual({ readOnlyHint: true })

    expect(getMcpToolMeta(
      oc.meta(mcp.tool({ name: 'name' })).meta(mcp.tool({ annotations: { readOnlyHint: true } })),
    )?.annotations).toEqual({ readOnlyHint: true })

    expect(getMcpToolMeta(
      oc.meta(mcp.tool({ annotations: { readOnlyHint: true } })).meta(mcp.tool({ annotations: undefined })),
    )?.annotations).toBeUndefined()
  })
})

import { oc } from '@orpc/contract'
import { os } from '@orpc/server'
import { getOpenRPCMeta, openrpc } from './meta'

describe('openrpc meta', () => {
  it('works with contracts, procedures and lazy routers', () => {
    expect(getOpenRPCMeta(oc.meta(openrpc({ summary: 'a' })))).toEqual({ summary: 'a' })
    expect(getOpenRPCMeta(os.meta(openrpc({ summary: 'a' })).handler(() => {}))).toMatchObject({ summary: 'a' })
    expect(getOpenRPCMeta(os.meta(openrpc({ summary: 'a' })).lazy(() => Promise.resolve({ default: {} })))).toMatchObject({ summary: 'a' })
    expect(getOpenRPCMeta(oc)).toBeUndefined()
  })

  it('overrides fields but concatenates tags', () => {
    expect(getOpenRPCMeta(oc.meta(openrpc({ summary: 'a', tags: ['x'] })).meta(openrpc({ summary: 'b', tags: ['y'] }))))
      .toMatchObject({ summary: 'b', tags: ['x', 'y'] })
    expect(getOpenRPCMeta(oc.meta(openrpc({ tags: ['x'] })).meta(openrpc({ tags: undefined })))?.tags).toBeUndefined()
  })

  it('composes specs', () => {
    const method = { name: 'm', params: [] }
    const addA = (m: any) => ({ ...m, a: 1 })
    const addB = (m: any) => ({ ...m, b: 1 })

    const chained = getOpenRPCMeta(oc.meta(openrpc({ spec: addA })).meta(openrpc({ spec: addB })))?.spec as any
    expect(chained(method)).toEqual({ ...method, a: 1, b: 1 })
    expect(getOpenRPCMeta(oc.meta(openrpc({ spec: addA })).meta(openrpc({ spec: method })))?.spec).toEqual({ ...method, a: 1 })
    expect(getOpenRPCMeta(oc.meta(openrpc({ spec: method })).meta(openrpc({ spec: addB })))?.spec).toEqual({ ...method, b: 1 })
    expect(getOpenRPCMeta(oc.meta(openrpc({ spec: addA })).meta(openrpc({ spec: undefined })))?.spec).toBeUndefined()
  })
})

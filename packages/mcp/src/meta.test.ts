import { os } from '@orpc/server'
import * as z from 'zod'
import { getMCPMeta, getMCPPrimitiveType, mcp } from './meta'

describe('mcp meta plugin', () => {
  it('annotates a procedure as a tool via mcp.tool()', () => {
    const procedure = os
      .meta(mcp.tool())
      .input(z.object({}))
      .handler(() => 'x')

    const meta = getMCPMeta(procedure)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('tool')
  })

  it('annotates a procedure as a resource via mcp.resource()', () => {
    const procedure = os
      .meta(mcp.resource({ uri: 'x://1' }))
      .input(z.object({}))
      .handler(() => 'x')

    const meta = getMCPMeta(procedure)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('resource')
    expect(meta?.uri).toBe('x://1')
  })

  it('annotates a procedure as a prompt via mcp.prompt()', () => {
    const procedure = os
      .meta(mcp.prompt())
      .input(z.object({}))
      .handler(() => 'x')

    const meta = getMCPMeta(procedure)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('prompt')
  })

  it('merges meta across multiple .meta() calls (annotations shallow-merge, scalars overwrite)', () => {
    const procedure = os
      .meta(mcp.tool({ description: 'a', annotations: { readOnlyHint: true } }))
      .meta(mcp.tool({ annotations: { idempotentHint: true } }))
      .input(z.object({}))
      .handler(() => 'x')

    const meta = getMCPMeta(procedure)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('tool')
    expect(meta?.description).toBe('a')
    expect(meta?.annotations).toEqual({ readOnlyHint: true, idempotentHint: true })
  })

  it('overwrites scalar fields when re-annotated', () => {
    const procedure = os
      .meta(mcp.tool({ description: 'first', title: 'T1' }))
      .meta(mcp.tool({ description: 'second' }))
      .input(z.object({}))
      .handler(() => 'x')

    const meta = getMCPMeta(procedure)
    expect(meta?.description).toBe('second')
    expect(meta?.title).toBe('T1')
  })

  it('returns undefined for a procedure not opted into MCP', () => {
    const procedure = os
      .input(z.object({}))
      .handler(() => 'x')

    expect(getMCPMeta(procedure)).toBeUndefined()
  })

  it('getMCPPrimitiveType defaults to tool', () => {
    expect(getMCPPrimitiveType({})).toBe('tool')
  })

  it('getMCPPrimitiveType respects an explicit type', () => {
    expect(getMCPPrimitiveType({ type: 'resource' })).toBe('resource')
    expect(getMCPPrimitiveType({ type: 'prompt' })).toBe('prompt')
    expect(getMCPPrimitiveType({ type: 'tool' })).toBe('tool')
  })

  it('exposes a plugin named ~mcp from each factory', () => {
    expect(mcp({}).name).toBe('~mcp')
    expect(mcp.tool().name).toBe('~mcp')
    expect(mcp.resource({ uri: 'x://1' }).name).toBe('~mcp')
    expect(mcp.prompt().name).toBe('~mcp')
  })
})

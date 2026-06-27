import { encodePromptMessages, encodeResourceContents, encodeToolResult } from './content'

describe('encodeToolResult', () => {
  it('wraps a string in a single text content block without structuredContent', () => {
    const result = encodeToolResult('hi', false)
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }] })
    expect(result.structuredContent).toBeUndefined()
  })

  it('adds structuredContent for a plain object when an output schema is declared', () => {
    const result = encodeToolResult({ a: 1 }, true)
    expect(result.structuredContent).toEqual({ a: 1 })
    expect(result.content[0].type).toBe('text')
    expect(result.content[0]).toMatchObject({ type: 'text', text: '{"a":1}' })
  })

  it('omits structuredContent for a plain object when no output schema is declared', () => {
    const result = encodeToolResult({ a: 1 }, false)
    expect(result.structuredContent).toBeUndefined()
    expect(result.content).toEqual([{ type: 'text', text: '{"a":1}' }])
  })

  it('passes through an array of pre-formed content blocks unchanged', () => {
    const result = encodeToolResult([{ type: 'text', text: 'x' }], false)
    expect(result.content).toEqual([{ type: 'text', text: 'x' }])
    expect(result.structuredContent).toBeUndefined()
  })

  it('returns empty content for undefined output', () => {
    const result = encodeToolResult(undefined, false)
    expect(result.content).toEqual([])
    expect(result.structuredContent).toBeUndefined()
  })
})

describe('encodeResourceContents', () => {
  it('encodes a string as a text/plain resource', () => {
    const result = encodeResourceContents('txt', 'u://1')
    expect(result).toEqual([{ uri: 'u://1', mimeType: 'text/plain', text: 'txt' }])
  })

  it('encodes a plain object as an application/json resource', () => {
    const result = encodeResourceContents({ a: 1 }, 'u://1')
    expect(result).toHaveLength(1)
    expect(result[0].uri).toBe('u://1')
    expect(result[0].mimeType).toBe('application/json')
    expect(JSON.parse(result[0].text!)).toEqual({ a: 1 })
  })

  it('respects an explicit mimeType for a string', () => {
    const result = encodeResourceContents('txt', 'u://1', 'text/markdown')
    expect(result).toEqual([{ uri: 'u://1', mimeType: 'text/markdown', text: 'txt' }])
  })
})

describe('encodePromptMessages', () => {
  it('wraps a string in a single user message', () => {
    const result = encodePromptMessages('hi')
    expect(result).toEqual({
      messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
    })
  })

  it('passes through a structured prompt result including its description', () => {
    const result = encodePromptMessages({
      messages: [{ role: 'assistant', content: { type: 'text', text: 'y' } }],
      description: 'd',
    })
    expect(result).toEqual({
      description: 'd',
      messages: [{ role: 'assistant', content: { type: 'text', text: 'y' } }],
    })
  })

  it('throws a TypeError for an unsupported output value', () => {
    expect(() => encodePromptMessages(123)).toThrow(TypeError)
  })
})

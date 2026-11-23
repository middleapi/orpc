import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { McpRegistrar } from '@orpc/mcp'
import { os } from '@orpc/server'
import { promiseWithResolvers, sleep } from '@orpc/shared'
import { describe, expect, it } from 'vitest'

import { fetchText, setFetchHandler, withTimeout } from './__shared__/fetch-handler'

/**
 * A lazy router whose first load waits on a timer created in the calling request,
 * so it never settles once that request ends, while later loads resolve at once.
 */
function createLazyRouter() {
  let loads = 0
  const firstLoadStarted = promiseWithResolvers<void>()

  const router = {
    planet: os.lazy(async () => {
      if (++loads === 1) {
        firstLoadStarted.resolve()
        await sleep(10)
      }

      return { default: { find: os.handler(() => ({ name: 'Earth' })) } }
    }),
  }

  return { router, firstLoadStarted: firstLoadStarted.promise, loads: () => loads }
}

function createServer() {
  return new McpServer({ name: 'test-server', version: '1.0.0' })
}

describe('mcpRegistrar with a lazy router on Workers', () => {
  it('registers tools in a later request after the request that started the load ends early', async () => {
    const { router, firstLoadStarted, loads } = createLazyRouter()
    const registrar = new McpRegistrar(router)

    setFetchHandler(async (request) => {
      if (new URL(request.url).pathname === '/a') {
        // ends once the load starts, without awaiting it, like a disconnected client
        registrar.register(createServer()).catch(() => {})
        return new Response(await withTimeout(firstLoadStarted.then(() => 'started')))
      }

      const result = await withTimeout(registrar.register(createServer()))
      return new Response(result === 'timeout' ? result : Object.keys(result.tools).join(','))
    })

    expect(await fetchText('/a')).toBe('started')
    expect(await fetchText('/b')).toBe('planet_find')
    expect(loads()).toBe(2)
    expect(await fetchText('/b')).toBe('planet_find')
    expect(loads()).toBe(2)
  })

  it('calls a tool through createMcpHandler in a later request after the request that started the load ends early', async () => {
    const { router, firstLoadStarted } = createLazyRouter()
    const registrar = new McpRegistrar(router)
    const handler = createMcpHandler(async () => {
      const server = createServer()
      await registrar.register(server)
      return server
    })

    const toolCall = () =>
      new Request('http://x/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'planet_find', arguments: {} },
        }),
      })

    setFetchHandler(async (request) => {
      if (new URL(request.url).pathname === '/a') {
        handler.fetch(toolCall()).catch(() => {})
        return new Response(await withTimeout(firstLoadStarted.then(() => 'started')))
      }

      const result = await withTimeout(handler.fetch(toolCall()).then((r) => r.text()))
      return new Response(result)
    })

    try {
      expect(await fetchText('/a')).toBe('started')

      const text = await fetchText('/b')
      // a stateless legacy request is answered over SSE
      expect(JSON.parse(text.match(/^data: (.*)$/m)![1]!)).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: '{"name":"Earth"}' }],
          structuredContent: { name: 'Earth' },
        },
      })
    } finally {
      await handler.close()
    }
  })
})

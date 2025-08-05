import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { os } from '../builder'
import { ContextStoragePlugin, getContext } from './context-storage'

describe('contextStoragePlugin', () => {
  it('should make context globally accessible', async () => {
    // Helper function that uses getContext
    const getMessage = () => {
      const context = getContext<{ message: string }>()
      return context.message
    }

    const router = os
      .$context<{ message: string }>()
      .use(({ context, next }) => {
        // Set message in middleware
        context.message = 'oRPC is awesome!'
        return next()
      })
      .route({
        method: 'GET',
        path: '/test',
      })
      .handler(() => {
        // Use helper function to get message via getContext
        return getMessage()
      })

    const handler = new OpenAPIHandler(router, {
      plugins: [new ContextStoragePlugin()],
    })

    const { response } = await handler.handle(
      new Request('https://example.com/test'),
      { context: { message: '' } }, // Will be overridden by middleware
    )

    expect(response?.status).toBe(200)
    const responseJson = await response?.json()
    expect(responseJson).toBe('oRPC is awesome!')
  })

  it('should work with async functions', async () => {
    const getAsyncData = async () => {
      // Simulate async operation
      await new Promise(resolve => setTimeout(resolve, 1))
      const context = getContext<{ data: string }>()
      return context.data
    }

    const router = os
      .$context<{ data: string }>()
      .route({
        method: 'POST',
        path: '/async',
      })
      .handler(async () => {
        return await getAsyncData()
      })

    const handler = new OpenAPIHandler(router, {
      plugins: [new ContextStoragePlugin()],
    })

    const { response } = await handler.handle(
      new Request('https://example.com/async', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      {
        context: { data: 'async-result' },
      },
    )

    expect(response?.status).toBe(200)
    expect(await response?.json()).toBe('async-result')
  })

  it('should throw error when context is not available', () => {
    expect(() => {
      getContext()
    }).toThrow('Context is not available. Make sure ContextStoragePlugin is enabled and this function is called within a request scope.')
  })

  it('should have correct plugin order', () => {
    const plugin = new ContextStoragePlugin()
    expect(plugin.order).toBe(1_000_000)
  })
})

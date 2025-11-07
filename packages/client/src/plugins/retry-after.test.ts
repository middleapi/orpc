import type { StandardLazyResponse } from '@orpc/standard-server'
import { StandardLink } from '../adapters/standard'
import { RetryAfterPlugin } from './retry-after'

describe('retryAfterPlugin', () => {
  const signal1 = AbortSignal.timeout(10000)

  const encode = vi.fn(async (path, input, { signal }): Promise<any> => ({
    url: new URL(`http://localhost/${path.join('/')}`),
    method: 'GET',
    headers: {},
    body: input,
    signal,
  }))

  const decode = vi.fn(async (response): Promise<unknown> => response.body())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  describe('core behavior', () => {
    it('should retry on 429/503 with retry-after header and succeed', async () => {
      let callCount = 0
      const clientCall = vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return {
            status: 429,
            headers: { 'retry-after': '2' },
            body: async () => 'rate limited',
          } satisfies StandardLazyResponse
        }
        return {
          status: 200,
          headers: {},
          body: async () => 'success',
        } satisfies StandardLazyResponse
      })

      const link = new StandardLink({ encode, decode }, { call: clientCall }, {
        plugins: [new RetryAfterPlugin()],
      })

      const promise = link.call(['test'], 'input', { context: {}, signal: signal1 })
      await vi.runAllTimersAsync()

      expect(await promise).toBe('success')
      expect(clientCall).toHaveBeenCalledTimes(2)
    })

    it('should not retry without retry-after header or on non-retryable status', async () => {
      const testCases = [
        { status: 200, headers: {}, body: 'success' },
        { status: 429, headers: {}, body: 'rate limited' },
        { status: 500, headers: { 'retry-after': '1' }, body: 'internal error' },
      ]

      for (const { status, headers, body } of testCases) {
        const clientCall = vi.fn(async () => ({
          status,
          headers,
          body: async () => body,
        } satisfies StandardLazyResponse))

        const link = new StandardLink({ encode, decode }, { call: clientCall }, {
          plugins: [new RetryAfterPlugin()],
        })

        const result = await link.call(['test'], 'input', { context: {}, signal: signal1 })

        expect(result).toBe(body)
        expect(clientCall).toHaveBeenCalledTimes(1)
        vi.clearAllMocks()
      }
    })
  })

  describe('retry-after parsing', () => {
    it('should parse various retry-after formats', async () => {
      const testCases = [
        { value: '3', description: 'seconds' },
        { value: new Date(Date.now() + 5000).toUTCString(), description: 'HTTP date' },
        { value: '  2  ', description: 'whitespace' },
      ]

      for (const { value, description } of testCases) {
        let callCount = 0
        const clientCall = vi.fn(async () => {
          callCount++
          if (callCount === 1) {
            return {
              status: 429,
              headers: { 'retry-after': value },
              body: async () => 'rate limited',
            } satisfies StandardLazyResponse
          }
          return {
            status: 200,
            headers: {},
            body: async () => 'success',
          } satisfies StandardLazyResponse
        })

        const link = new StandardLink({ encode, decode }, { call: clientCall }, {
          plugins: [new RetryAfterPlugin()],
        })

        const promise = link.call(['test'], 'input', { context: {}, signal: signal1 })
        await vi.runAllTimersAsync()

        expect(await promise).toBe('success')
        expect(clientCall).toHaveBeenCalledTimes(2)
        vi.clearAllMocks()
      }
    })

    it('should not retry on invalid retry-after values', async () => {
      const invalidValues = ['invalid', '']

      for (const value of invalidValues) {
        const clientCall = vi.fn(async () => ({
          status: 429,
          headers: { 'retry-after': value },
          body: async () => 'rate limited',
        } satisfies StandardLazyResponse))

        const link = new StandardLink({ encode, decode }, { call: clientCall }, {
          plugins: [new RetryAfterPlugin()],
        })

        const result = await link.call(['test'], 'input', { context: {}, signal: signal1 })

        expect(result).toBe('rate limited')
        expect(clientCall).toHaveBeenCalledTimes(1)
        vi.clearAllMocks()
      }
    })
  })

  describe('maxAttempts', () => {
    it('should respect maxAttempts (static and dynamic)', async () => {
      const testCases = [
        { maxAttempts: undefined, expected: 3, description: 'default' },
        { maxAttempts: 5, expected: 5, description: 'custom' },
        { maxAttempts: vi.fn(() => 2), expected: 2, description: 'dynamic' },
      ]

      for (const { maxAttempts, expected, description } of testCases) {
        const clientCall = vi.fn(async () => ({
          status: 429,
          headers: { 'retry-after': '0' },
          body: async () => 'rate limited',
        } satisfies StandardLazyResponse))

        const link = new StandardLink({ encode, decode }, { call: clientCall }, {
          plugins: [new RetryAfterPlugin(maxAttempts !== undefined ? { maxAttempts } : {})],
        })

        const promise = link.call(['test'], 'input', { context: {}, signal: signal1 })
        await vi.runAllTimersAsync()

        expect(await promise).toBe('rate limited')
        expect(clientCall).toHaveBeenCalledTimes(expected)

        if (typeof maxAttempts === 'function') {
          expect(maxAttempts).toHaveBeenCalledWith(
            expect.objectContaining({ status: 429 }),
            expect.objectContaining({ context: {} }),
          )
        }

        vi.clearAllMocks()
      }
    })
  })

  describe('timeout and custom condition', () => {
    it('should stop retrying after timeout', async () => {
      const clientCall = vi.fn(async () => ({
        status: 429,
        headers: { 'retry-after': '3' },
        body: async () => 'rate limited',
      } satisfies StandardLazyResponse))

      const link = new StandardLink({ encode, decode }, { call: clientCall }, {
        plugins: [new RetryAfterPlugin({ timeout: 5000 })],
      })

      const promise = link.call(['test'], 'input', { context: {}, signal: signal1 })
      await vi.runAllTimersAsync()

      expect(await promise).toBe('rate limited')
      expect(clientCall).toHaveBeenCalledTimes(2)
    })

    it('should support dynamic timeout function', async () => {
      const clientCall = vi.fn(async () => ({
        status: 429,
        headers: { 'retry-after': '2' },
        body: async () => 'rate limited',
      } satisfies StandardLazyResponse))

      const timeoutFn = vi.fn(() => 3000)

      const link = new StandardLink({ encode, decode }, { call: clientCall }, {
        plugins: [new RetryAfterPlugin({ timeout: timeoutFn })],
      })

      const promise = link.call(['test'], 'input', { context: {}, signal: signal1 })
      await vi.runAllTimersAsync()

      expect(await promise).toBe('rate limited')
      expect(clientCall).toHaveBeenCalledTimes(2)
      expect(timeoutFn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 429 }),
        expect.objectContaining({ context: {}, signal: signal1 }),
      )
    })

    it('should respect custom condition function', async () => {
      let callCount = 0
      const clientCall = vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return {
            status: 400,
            headers: { 'retry-after': '1' },
            body: async () => 'bad request',
          } satisfies StandardLazyResponse
        }
        return {
          status: 200,
          headers: {},
          body: async () => 'success',
        } satisfies StandardLazyResponse
      })

      const condition = vi.fn((response: StandardLazyResponse) => response.status === 400)

      const link = new StandardLink({ encode, decode }, { call: clientCall }, {
        plugins: [new RetryAfterPlugin({ condition })],
      })

      const promise = link.call(['test'], 'input', { context: {}, signal: signal1 })
      await vi.runAllTimersAsync()

      expect(await promise).toBe('success')
      expect(clientCall).toHaveBeenCalledTimes(2)
      expect(condition).toHaveBeenCalledWith(
        expect.objectContaining({ status: 400 }),
        expect.objectContaining({ context: {}, signal: signal1 }),
      )
    })
  })

  describe('signal handling', () => {
    it('should stop retrying when signal is aborted during delay', async () => {
      const clientCall = vi.fn(async () => ({
        status: 429,
        headers: { 'retry-after': '5' },
        body: async () => 'rate limited',
      } satisfies StandardLazyResponse))

      const controller = new AbortController()

      const link = new StandardLink({ encode, decode }, { call: clientCall }, {
        plugins: [new RetryAfterPlugin()],
      })

      const promise = link.call(['test'], 'input', { context: {}, signal: controller.signal })

      await vi.advanceTimersByTimeAsync(2000)
      controller.abort()
      await vi.advanceTimersByTimeAsync(3000)

      expect(await promise).toBe('rate limited')
      expect(clientCall).toHaveBeenCalledTimes(1)
    })

    it('should not retry if signal is already aborted', async () => {
      const clientCall = vi.fn(async () => ({
        status: 429,
        headers: { 'retry-after': '1' },
        body: async () => 'rate limited',
      } satisfies StandardLazyResponse))

      const controller = new AbortController()
      controller.abort()

      const link = new StandardLink({ encode, decode }, { call: clientCall }, {
        plugins: [new RetryAfterPlugin()],
      })

      const result = await link.call(['test'], 'input', { context: {}, signal: controller.signal })

      expect(result).toBe('rate limited')
      expect(clientCall).toHaveBeenCalledTimes(1)
    })
  })
})

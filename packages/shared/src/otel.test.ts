import { getGlobalOtelConfig, isInSentryContext, runInSpanContext, runWithSpan, setGlobalOtelConfig, setSpanAttribute, setSpanError, startSpan, toOtelException, toSpanAttributeValue } from './otel'

function createMockSpan(name = 'test-span') {
  return {
    name,
    end: vi.fn(),
    setAttribute: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
  }
}

function createMockTracer() {
  return {
    startSpan: vi.fn(),
    startActiveSpan: vi.fn(),
  }
}

function createMockOtelConfig() {
  const mockTracer = createMockTracer()
  return {
    tracer: mockTracer,
    trace: {
      setSpan: vi.fn(),
    },
    context: {
      active: vi.fn().mockReturnValue({}),
      with: vi.fn(),
    },
  }
}

beforeEach(() => {
  const originalConfig = getGlobalOtelConfig()

  setGlobalOtelConfig(undefined)

  afterEach(() => {
    setGlobalOtelConfig(originalConfig)
  })
})

describe('tracing', () => {
  describe('startSpan', () => {
    it('returns undefined when no global tracer is set', () => {
      expect(startSpan('test-span')).toBeUndefined()
    })

    it('creates and returns a span when global tracer is set', () => {
      const mockSpan = createMockSpan()
      const mockConfig = createMockOtelConfig()
      mockConfig.tracer.startSpan.mockReturnValue(mockSpan)

      setGlobalOtelConfig(mockConfig as any)

      const result = startSpan('test-span', { attributes: { key: 'value' } })

      expect(result).toBe(mockSpan)
      expect(mockConfig.tracer.startSpan).toHaveBeenCalledWith('test-span', { attributes: { key: 'value' } }, undefined)
    })
  })

  describe('toOtelException', () => {
    it('converts Error objects to OpenTelemetry Exception format', () => {
      const error = new Error('Test error message')
      error.name = 'TestError'
      error.stack = 'Error: Test error message\n    at test.js:1:1'

      const result = toOtelException(error)

      expect(result).toEqual({
        message: 'Test error message',
        name: 'TestError',
        stack: 'Error: Test error message\n    at test.js:1:1',
      })
    })

    it('includes code property when Error has string code', () => {
      const error = new Error('Network error') as any
      error.code = 'ECONNREFUSED'

      const result = toOtelException(error)

      expect(result).toEqual({
        message: 'Network error',
        name: 'Error',
        stack: error.stack,
        code: 'ECONNREFUSED',
      })
    })

    it('includes code property when Error has numeric code', () => {
      const error = new Error('HTTP error') as any
      error.code = 404

      const result = toOtelException(error)

      expect(result).toEqual({
        message: 'HTTP error',
        name: 'Error',
        stack: error.stack,
        code: 404,
      })
    })

    it('excludes code property when it is not string or number', () => {
      const error = new Error('Test error') as any
      error.code = { custom: 'object' }

      const result = toOtelException(error)

      expect(result).toEqual({
        message: 'Test error',
        name: 'Error',
        stack: error.stack,
      })
      expect(result).not.toHaveProperty('code')
    })

    it('converts non-Error objects to Exception with string message', () => {
      const result1 = toOtelException('Plain string error')
      expect(result1).toEqual({ message: 'Plain string error' })

      const result2 = toOtelException(42)
      expect(result2).toEqual({ message: '42' })

      const result3 = toOtelException({ custom: 'error' })
      expect(result3).toEqual({ message: '[object Object]' })

      const result4 = toOtelException(null)
      expect(result4).toEqual({ message: 'null' })

      const result5 = toOtelException(undefined)
      expect(result5).toEqual({ message: 'undefined' })
    })

    it('handles custom Error objects', () => {
      class CustomError extends Error {
        code = 'CUSTOM_ERROR'
        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
        }
      }

      const error = new CustomError('Custom error message')
      const result = toOtelException(error)

      expect(result).toEqual({
        message: 'Custom error message',
        name: 'CustomError',
        code: 'CUSTOM_ERROR',
        stack: error.stack,
      })
    })
  })

  describe('setSpanError', () => {
    it('does nothing if span is undefined', () => {
      setSpanError(undefined, new Error('Test error'))
    })

    it('records exception and sets error status on span', () => {
      const mockSpan = createMockSpan() as any
      const error = new Error('Test error')

      setSpanError(mockSpan, error)

      expect(mockSpan.recordException).toHaveBeenCalledWith({
        message: 'Test error',
        name: 'Error',
        stack: error.stack,
      })
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 2, // SPAN_ERROR_STATUS
        message: 'Test error',
      })
    })

    it('does not set error status if signal is aborted with the same error', () => {
      const mockSpan = createMockSpan() as any
      const error = new Error('Test error')
      const controller = new AbortController()
      controller.abort(error)

      setSpanError(mockSpan, error, { signal: controller.signal })

      expect(mockSpan.recordException).toHaveBeenCalledWith({
        message: 'Test error',
        name: 'Error',
        stack: error.stack,
      })
      expect(mockSpan.setStatus).not.toHaveBeenCalled()
    })
  })

  describe('setSpanAttribute', () => {
    const mockSpan = createMockSpan() as any

    it('does nothing if span is undefined or value is undefined', () => {
      setSpanAttribute(undefined, 'key', 'value')
      setSpanAttribute(mockSpan, 'key', undefined)

      expect(mockSpan.setAttribute).not.toHaveBeenCalled()
    })

    it('sets attribute on span when value is defined', () => {
      setSpanAttribute(mockSpan, 'key', 'value')
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('key', 'value')
    })
  })

  it('toSpanAttributeValue serializes data correctly', () => {
    const data = {
      key: 'value',
      num: 123,
      bool: true,
      arr: [1, 2, 3],
      bigint: 123n,
      set: new Set([1, 2, 3]),
      map: new Map([['a', 1], ['b', 2]]),
    }

    expect(toSpanAttributeValue(data)).toEqual('{"key":"value","num":123,"bool":true,"arr":[1,2,3],"bigint":"123","set":[1,2,3],"map":[["a",1],["b",2]]}')
    expect(toSpanAttributeValue({
      toJSON() {
        throw new Error('Custom error')
      },
    })).toEqual('[object Object]')

    expect(toSpanAttributeValue(undefined)).toEqual('undefined')
  })

  describe('runWithSpan', () => {
    it('executes function without span when no global tracer is set', async () => {
      const fn = vi.fn().mockResolvedValue(123)

      const result = await runWithSpan({ name: 'test-span' }, fn)

      expect(fn).toHaveBeenCalledWith()
      expect(result).toBe(123)
    })

    it('executes function with active span when global tracer is set', async () => {
      const mockSpan = createMockSpan()
      const mockConfig = createMockOtelConfig()
      mockConfig.tracer.startActiveSpan.mockImplementation((name, options, callback) =>
        callback(mockSpan),
      )
      setGlobalOtelConfig(mockConfig as any)

      const fn = vi.fn().mockResolvedValue(456)

      const result = await runWithSpan({ name: 'test-span' }, fn)

      expect(result).toBe(456)
      expect(mockConfig.tracer.startActiveSpan).toHaveBeenCalledWith('test-span', {}, expect.any(Function))
      expect(fn).toHaveBeenCalledWith(mockSpan)
      expect(mockSpan.end).toHaveBeenCalled()
    })

    it('records and re-throws Error exceptions', async () => {
      const mockSpan = createMockSpan()
      const mockConfig = createMockOtelConfig()
      mockConfig.tracer.startActiveSpan.mockImplementation((name, options, callback) =>
        callback(mockSpan),
      )
      setGlobalOtelConfig(mockConfig as any)

      const error = new Error('Test error')
      const fn = vi.fn().mockRejectedValue(error)

      await expect(runWithSpan({ name: 'test-span' }, fn)).rejects.toThrow('Test error')

      expect(mockSpan.recordException).toHaveBeenCalledWith({ message: 'Test error', name: 'Error', stack: error.stack })
      expect(mockSpan.end).toHaveBeenCalled()
    })

    it('can pass context to the span', async () => {
      const mockSpan = createMockSpan()
      const mockConfig = createMockOtelConfig()
      mockConfig.tracer.startActiveSpan.mockImplementation((name, options, context, callback) =>
        callback(mockSpan),
      )
      setGlobalOtelConfig(mockConfig as any)

      const context = { user: 'test-user' } as any
      const fn = vi.fn().mockResolvedValue('result')

      const result = await runWithSpan({ name: 'test-span', context }, fn)

      expect(result).toBe('result')
      expect(mockConfig.tracer.startActiveSpan).toHaveBeenCalledWith('test-span', {}, context, expect.any(Function))
      expect(fn).toHaveBeenCalledWith(mockSpan)
    })
  })

  describe('runInSpanContext', () => {
    it('executes function normally when span is undefined', async () => {
      const fn = vi.fn().mockResolvedValue('result')

      const result = await runInSpanContext(undefined, fn)

      expect(result).toBe('result')
      expect(fn).toHaveBeenCalledWith()
    })

    it('executes function normally when no global otel config is set', async () => {
      const mockSpan = createMockSpan()
      const fn = vi.fn().mockResolvedValue('result')

      // Ensure no global config is set
      setGlobalOtelConfig(undefined)

      const result = await runInSpanContext(mockSpan as any, fn)

      expect(result).toBe('result')
      expect(fn).toHaveBeenCalledWith()
    })

    it('executes function within span context when span and config are provided', async () => {
      const mockSpan = createMockSpan()
      const mockConfig = createMockOtelConfig()
      const mockContext = { spanContext: 'test' }

      mockConfig.context.active.mockReturnValue({ active: 'context' })
      mockConfig.trace.setSpan.mockReturnValue(mockContext)
      mockConfig.context.with.mockImplementation((ctx, callback) => {
        expect(ctx).toBe(mockContext)
        return callback()
      })

      setGlobalOtelConfig(mockConfig as any)

      const fn = vi.fn().mockResolvedValue('context-result')

      const result = await runInSpanContext(mockSpan as any, fn)

      expect(result).toBe('context-result')
      expect(mockConfig.context.active).toHaveBeenCalled()
      expect(mockConfig.trace.setSpan).toHaveBeenCalledWith({ active: 'context' }, mockSpan)
      expect(mockConfig.context.with).toHaveBeenCalledWith(mockContext, fn)
    })

    it('propagates errors from the function', async () => {
      const mockSpan = createMockSpan()
      const mockConfig = createMockOtelConfig()
      const mockContext = { spanContext: 'error-test' }

      mockConfig.context.active.mockReturnValue({ active: 'context' })
      mockConfig.trace.setSpan.mockReturnValue(mockContext)
      mockConfig.context.with.mockImplementation((ctx, callback) => callback())

      setGlobalOtelConfig(mockConfig as any)

      const error = new Error('Function error')
      const fn = vi.fn().mockRejectedValue(error)

      await expect(runInSpanContext(mockSpan as any, fn)).rejects.toThrow('Function error')
      expect(fn).toHaveBeenCalledWith()
    })
  })

  describe('isInSentryContext', () => {
    it('return true when the sentry symbol is defined in the context', () => {
      const mockConfig = createMockOtelConfig()
      mockConfig.context.active.mockReturnValue({
        getValue: vi.fn((key) => {
          const symbol = Symbol.for('sentry_scopes')
          return key === symbol ? symbol : undefined
        }),
      })

      setGlobalOtelConfig(mockConfig as any)

      expect(isInSentryContext()).toEqual(true)
    })

    it('return false when there isn\'t any context', () => {
      expect(isInSentryContext()).toEqual(false)
    })

    it('return false when there isn\'t any sentry symbol in the context', () => {
      const mockConfig = createMockOtelConfig()
      mockConfig.context.active.mockReturnValue({
        getValue: vi.fn(() => undefined),
      })

      setGlobalOtelConfig(mockConfig as any)

      expect(isInSentryContext()).toEqual(false)
    })
  })
})

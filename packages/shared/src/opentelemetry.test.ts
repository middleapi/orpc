import {
  getOpenTelemetryConfig,
  recordSpanError,
  runInSpanContext,
  runWithSpan,
  setOpenTelemetryConfig,
  setSpanAttributeIfDefined,
  startSpan,
  toOtelException,
  toSpanAttributeValue,
} from './opentelemetry'

function createMockSpan() {
  return {
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

describe('opentelemetry', () => {
  beforeEach(() => {
    const originalConfig = getOpenTelemetryConfig()
    setOpenTelemetryConfig(undefined)
    return () => {
      setOpenTelemetryConfig(originalConfig)
    }
  })

  describe('config', () => {
    it('sets and gets config', () => {
      const config = createMockOtelConfig() as any
      setOpenTelemetryConfig(config)
      expect(getOpenTelemetryConfig()).toBe(config)
    })
  })

  describe('startSpan', () => {
    it('returns undefined when no config is set', () => {
      expect(startSpan('test')).toBeUndefined()
    })

    it('creates a span when config is set', () => {
      const mockSpan = createMockSpan()
      const config = createMockOtelConfig()
      config.tracer.startSpan.mockReturnValue(mockSpan)
      setOpenTelemetryConfig(config as any)

      const result = startSpan({ name: 'test', attributes: { a: 1 }, context: 'context' as any })
      expect(result).toBe(mockSpan)
      expect(config.tracer.startSpan).toHaveBeenCalledWith('test', { attributes: { a: 1 } }, 'context')
    })

    it('accepts options as string', () => {
      const mockSpan = createMockSpan()
      const config = createMockOtelConfig()
      config.tracer.startSpan.mockReturnValue(mockSpan)
      setOpenTelemetryConfig(config as any)

      const result = startSpan('test')
      expect(result).toBe(mockSpan)
      expect(config.tracer.startSpan).toHaveBeenCalledWith('test', { }, undefined)
    })
  })

  describe('recordSpanError', () => {
    it('does nothing when span is undefined', () => {
      expect(() => recordSpanError(undefined, new Error('message'))).not.toThrow()
    })

    it('records exception and sets status on span', () => {
      const mockSpan = createMockSpan() as any
      const error = new Error('test')
      recordSpanError(mockSpan, error)

      expect(mockSpan.recordException).toHaveBeenCalledWith(expect.objectContaining({ message: 'test' }))
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2, message: 'test' })
    })

    it('does not set status for AbortError', () => {
      const mockSpan = createMockSpan() as any
      const error = new Error('aborted')
      error.name = 'AbortError'
      recordSpanError(mockSpan, error)

      expect(mockSpan.recordException).toHaveBeenCalled()
      expect(mockSpan.setStatus).not.toHaveBeenCalled()
    })
  })

  describe('setSpanAttributeIfDefined', () => {
    it('does nothing when span is undefined', () => {
      expect(() => setSpanAttributeIfDefined(undefined, 'key', 'value')).not.toThrow()
    })

    it('does nothing when value is undefined', () => {
      const mockSpan = createMockSpan() as any
      setSpanAttributeIfDefined(mockSpan, 'key', undefined)
      expect(mockSpan.setAttribute).not.toHaveBeenCalled()
    })

    it('sets attribute when value is defined', () => {
      const mockSpan = createMockSpan() as any
      setSpanAttributeIfDefined(mockSpan, 'key', 'value')
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('key', 'value')
    })
  })

  describe('toOtelException', () => {
    it('converts error to exception', () => {
      const error = new Error('test')
      error.stack = 'stack'
      const exception = toOtelException(error)
      expect(exception).toEqual({ message: 'test', name: 'Error', stack: 'stack' })
    })

    it('includes numeric code', () => {
      const error = new Error('test') as any
      error.code = 123
      const exception = toOtelException(error)
      expect(exception.code).toBe(123)
    })

    it('includes string code', () => {
      const error = new Error('test') as any
      error.code = 'CODE'
      const exception = toOtelException(error)
      expect(exception.code).toBe('CODE')
    })

    it('converts non-error to exception', () => {
      expect(toOtelException('test')).toEqual({ message: 'test' })
      expect(toOtelException(123)).toEqual({ message: '123' })
    })
  })

  describe('toSpanAttributeValue', () => {
    it('serializes values', () => {
      expect(toSpanAttributeValue(undefined)).toBe('undefined')
      expect(toSpanAttributeValue(123)).toBe('123')
      expect(toSpanAttributeValue('abc')).toBe('"abc"')
      expect(toSpanAttributeValue({ a: 1 })).toBe('{"a":1}')
      expect(toSpanAttributeValue(123n)).toBe('"123"')
      expect(toSpanAttributeValue(new Set([1]))).toBe('[1]')
      expect(toSpanAttributeValue(new Map([[1, 2]]))).toBe('[[1,2]]')
    })

    it('handles circular references or errors during stringify', () => {
      const obj: any = {}
      obj.self = obj
      expect(toSpanAttributeValue(obj)).toBe('[object Object]')
    })
  })

  describe('runWithSpan', () => {
    it('runs function without span when no tracer', async () => {
      const fn = vi.fn().mockResolvedValue('out')
      const result = await runWithSpan('test', fn)
      expect(result).toBe('out')
      expect(fn).toHaveBeenCalled()
    })

    it('starts active span and runs function', async () => {
      const config = createMockOtelConfig()
      const mockSpan = createMockSpan()
      config.tracer.startActiveSpan.mockImplementation((name, options, cb) => cb(mockSpan))
      setOpenTelemetryConfig(config as any)

      const fn = vi.fn().mockResolvedValue('out')
      const result = await runWithSpan('test', fn)

      expect(result).toBe('out')
      expect(config.tracer.startActiveSpan).toHaveBeenCalledWith('test', { name: 'test' }, expect.any(Function))
      expect(fn).toHaveBeenCalledWith(mockSpan)
      expect(mockSpan.end).toHaveBeenCalled()
    })

    it('records error and ends span when function fails', async () => {
      const config = createMockOtelConfig()
      const mockSpan = createMockSpan()
      config.tracer.startActiveSpan.mockImplementation((name, options, cb) => cb(mockSpan))
      setOpenTelemetryConfig(config as any)

      const error = new Error('fail')
      const fn = vi.fn().mockRejectedValue(error)

      await expect(runWithSpan('test', fn)).rejects.toThrow('fail')
      expect(mockSpan.recordException).toHaveBeenCalled()
      expect(mockSpan.end).toHaveBeenCalled()
    })

    it('supports context as option in runWithSpan', async () => {
      const config = createMockOtelConfig()
      const mockSpan = createMockSpan()
      config.tracer.startActiveSpan.mockImplementation((name, options, context, cb) => cb(mockSpan))
      setOpenTelemetryConfig(config as any)

      const fn = vi.fn().mockResolvedValue('out')
      const result = await runWithSpan({ name: 'test', context: 'ctx' } as any, fn)

      expect(result).toBe('out')
      expect(config.tracer.startActiveSpan).toHaveBeenCalledWith('test', expect.anything(), 'ctx', expect.any(Function))
    })
  })

  describe('runInSpanContext', () => {
    it('runs function normally when no span or no config', async () => {
      const fn = vi.fn().mockResolvedValue('out')
      expect(await runInSpanContext(undefined, fn)).toBe('out')

      const mockSpan = createMockSpan()
      expect(await runInSpanContext(mockSpan as any, fn)).toBe('out')
    })

    it('runs function within span context', async () => {
      const config = createMockOtelConfig()
      const mockSpan = createMockSpan()
      setOpenTelemetryConfig(config as any)

      const mockContext = { ctx: 1 }
      config.trace.setSpan.mockReturnValue(mockContext)
      config.context.with.mockImplementation((ctx, cb) => cb())

      const fn = vi.fn().mockResolvedValue('result')
      const result = await runInSpanContext(mockSpan as any, fn)

      expect(result).toBe('result')
      expect(config.trace.setSpan).toHaveBeenCalledWith(expect.anything(), mockSpan)
      expect(config.context.with).toHaveBeenCalledWith(mockContext, expect.any(Function))
      expect(fn).toHaveBeenCalled()
    })
  })
})

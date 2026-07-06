import { logError } from './log'

describe('logError', () => {
  it('should log error to console.error', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('Test error')
    logError(error)
    expect(consoleErrorSpy).toHaveBeenCalledWith(error)
    consoleErrorSpy.mockRestore()
  })

  it('should do nothing if console.error is not available', () => {
    const originalConsoleError = console.error
    // @ts-expect-error: Temporarily override console.error for testing
    console.error = undefined
    const error = new Error('Test error')
    expect(() => logError(error)).not.toThrow()
    // Restore the original console.error function
    console.error = originalConsoleError
  })
})

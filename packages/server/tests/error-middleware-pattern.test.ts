import { createSafeClient } from '@orpc/client'
import { createRouterClient, os } from '../src'

describe('error middleware patterns', () => {
  it('should have defined=true when using original supported pattern (same base for middleware and procedure)', async () => {
    // ✅ CORRECT: Define errors on base, use same base for both middleware and procedure
    const base = os.errors({
      UNAUTHORIZED: {},
    })

    const middleware = base.middleware(async ({ next, context, errors }) => {
      throw errors.UNAUTHORIZED()
    })

    const router = base.use(middleware).handler(async () => {})

    const client = createSafeClient(createRouterClient(router))
    const [error,, isDefined] = await client()

    // Should have defined=true because error was thrown from defined error map
    expect((error as any).defined).toBe(true)
    expect(isDefined).toBe(true)
    expect((error as any).code).toBe('UNAUTHORIZED')
  })

  it('should have defined=true with automatic error map merging (new behavior)', async () => {
    // ✅ NEW BEHAVIOR: Middleware error maps are automatically merged
    const middleware = os.errors({
      UNAUTHORIZED: {},
    }).middleware(async ({ next, context, errors }) => {
      throw errors.UNAUTHORIZED()
    })

    // Using base os (no errors) but middleware error map should be automatically merged
    const router = os.use(middleware).handler(async () => {})

    const client = createSafeClient(createRouterClient(router))
    const [error,, isDefined] = await client()

    // Should now have defined=true because middleware error map gets merged automatically
    expect((error as any).defined).toBe(true)
    expect(isDefined).toBe(true)
    expect((error as any).code).toBe('UNAUTHORIZED')
    // Verify the error map was merged
    expect(router['~orpc'].errorMap).toHaveProperty('UNAUTHORIZED')
  })

  it('should merge errors from different sources correctly', async () => {
    const middleware = os.errors({
      UNAUTHORIZED: {},
    }).middleware(async ({ next, context, errors }) => {
      // Don't throw, just continue to test error map merging
      return next({ context })
    })
    const router = os
      .use(middleware)
      .errors({ NOT_FOUND: {} })
      .handler(async ({ errors }) => {
        // Should have access to both UNAUTHORIZED and NOT_FOUND
        expect('UNAUTHORIZED' in errors).toBe(true)
        expect('NOT_FOUND' in errors).toBe(true)

        // @ts-expect-error TODO: Currently, errors defined in middleware is not inferred into the procedure
        const unauthorizedError = errors.UNAUTHORIZED()
        const notFoundError = errors.NOT_FOUND()

        expect(unauthorizedError.defined).toBe(true)
        expect(notFoundError.defined).toBe(true)

        throw notFoundError
      })

    const client = createSafeClient(createRouterClient(router))
    const [error,, isDefined] = await client()

    expect((error as any).defined).toBe(true)
    expect(isDefined).toBe(true)
    expect((error as any).code).toBe('NOT_FOUND')
  })
})

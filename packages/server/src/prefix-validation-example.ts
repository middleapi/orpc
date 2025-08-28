import * as z from 'zod'
// Example usage of os.prefix with dynamic parameter validation using Zod
import { os } from './builder'

// Basic prefix without validation (existing functionality)
const basicRouter = os.prefix('/api/v1').router({
  health: os.handler(() => 'OK'),
  version: os.handler(() => '1.0.0'),
})

// Prefix with UUID validation using Zod
const organizationRouter = os.prefix('/{organizationId}', {
  organizationId: z.uuid(),
}).router({
  get: os.handler(({ context }) => {
    // Note: params will be available when the middleware is fully integrated
    // For now, we access via context.params
    const orgId = (context as any).params?.organizationId
    return { organization: orgId }
  }),

  users: os.router({
    list: os.handler(() => 'List users'),
    create: os.handler(() => 'Create user'),
  }),
})

// Prefix with number validation using Zod
const userRouter = os.prefix('/{userId}', {
  userId: z.coerce.number().int().positive(),
}).router({
  get: os.handler(({ context }) => {
    const userId = (context as any).params?.userId
    return { user: userId }
  }),

  update: os.handler(() => 'Update user'),
})

// Prefix with string validation using Zod
const projectRouter = os.prefix('/{projectName}', {
  projectName: z.string().min(1).max(100),
}).router({
  get: os.handler(({ context }) => {
    const projectName = (context as any).params?.projectName
    return { project: projectName }
  }),
})

// Multiple parameters in prefix with Zod validation
const complexRouter = os.prefix('/{organizationId}/{userId}', {
  organizationId: z.uuid(),
  userId: z.coerce.number().int().positive(),
}).router({
  profile: os.handler(({ context }) => {
    const params = (context as any).params
    return {
      organization: params?.organizationId,
      user: params?.userId,
    }
  }),
})

// Nested prefixes with Zod validation
const nestedRouter = os.prefix('/{organizationId}', {
  organizationId: z.uuid(),
}).router({
  users: os.prefix('/{userId}', {
    userId: z.coerce.number().int().positive(),
  }).router({
    profile: os.handler(({ context }) => {
      const params = (context as any).params
      return {
        organizationId: params?.organizationId,
        userId: params?.userId,
      }
    }),
  }),
})

// Advanced Zod validation examples
const advancedRouter = os.prefix('/{slug}/{version}', {
  slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(50),
  version: z.coerce.number().int().min(1).max(999),
}).router({
  get: os.handler(({ context }) => {
    const params = (context as any).params
    return {
      slug: params?.slug,
      version: params?.version,
    }
  }),
})

// Enum validation example
const statusRouter = os.prefix('/{status}', {
  status: z.enum(['active', 'inactive', 'pending']),
}).router({
  get: os.handler(({ context }) => {
    const status = (context as any).params?.status
    return { status }
  }),
})

// Custom validation example
const customRouter = os.prefix('/{email}', {
  email: z.email().transform(val => val.toLowerCase()),
}).router({
  get: os.handler(({ context }) => {
    const email = (context as any).params?.email
    return { email }
  }),
})

// Middleware with parameter access
const middlewareExample = os.prefix('/{organizationId}', {
  organizationId: z.uuid(),
}).use(({ next, context }) => {
  // Middleware can access validated organizationId via context
  const orgId = (context as any).params?.organizationId

  // Add organization data to context
  return next({
    context: {
      ...context,
      organization: { id: orgId },
    },
  })
}).router({
  status: os.handler(({ context }) => {
    // Both context.organization and context.params are available
    return {
      orgFromContext: (context as any).organization,
      orgFromParams: (context as any).params?.organizationId,
    }
  }),
})

// Export examples
export {
  advancedRouter,
  basicRouter,
  complexRouter,
  customRouter,
  middlewareExample,
  nestedRouter,
  organizationRouter,
  projectRouter,
  statusRouter,
  userRouter,
}

// Type examples to demonstrate compile-time safety
export function typeExamples() {
  // These should compile without errors
  const basic = os.prefix('/api')
  const withUuid = os.prefix('/{id}', { id: z.uuid() })
  const withNumber = os.prefix('/{count}', { count: z.coerce.number().int() })
  const withString = os.prefix('/{name}', { name: z.string().min(1) })
  const multiParam = os.prefix('/{org}/{user}', {
    org: z.uuid(),
    user: z.coerce.number().int(),
  })

  return { basic, withUuid, withNumber, withString, multiParam }
}

/*
Expected usage patterns with Zod:

1. Basic prefix (no changes to existing API):
   os.prefix('/api/v1').router({ ... })

2. UUID parameter validation:
   os.prefix('/{organizationId}', { organizationId: z.uuid() })
   - Validates that organizationId matches UUID format
   - Provides type-safe access via context.params.organizationId
   - Parameter is required and guaranteed to exist

3. Number parameter validation:
   os.prefix('/{userId}', { userId: z.coerce.number().int().positive() })
   - Converts and validates that userId is a positive integer
   - Provides type-safe access via context.params.userId
   - Parameter is required and guaranteed to exist

4. String parameter validation:
   os.prefix('/{projectName}', { projectName: z.string().min(1).max(100) })
   - Ensures projectName is a string with length constraints
   - Provides type-safe access via context.params.projectName
   - Parameter is required and guaranteed to exist

5. Multiple parameters:
   os.prefix('/{orgId}/{userId}', {
     orgId: z.uuid(),
     userId: z.coerce.number().int()
   })
   - Validates both parameters according to their Zod schemas
   - Provides type-safe access to both parameters
   - All parameters are required and guaranteed to exist

6. Advanced validation:
   os.prefix('/{slug}/{version}', {
     slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(50),
     version: z.coerce.number().int().min(1).max(999)
   })
   - Custom regex patterns, length constraints, and numeric ranges
   - Full power of Zod validation

The middleware will:
- Extract parameters from the URL path
- Validate each parameter using Zod schemas
- Handle type coercion automatically (e.g., string to number)
- Throw validation errors for invalid parameters
- Inject validated parameters into the context for handlers to access
- Ensure all defined parameters are present and valid before handler execution

Key benefits:
- No need for fallback values or null checks
- Parameters are guaranteed to exist and be valid
- Clean, readable handler code
- Automatic error handling for invalid parameters
- Full TypeScript support with proper typing
- Leverage the full power of Zod validation
- Type coercion and transformation support

Note: Currently, parameters are accessed via context.params until the full integration
with the handler types is complete. This will be updated to provide direct access
to params in the handler function signature.
*/

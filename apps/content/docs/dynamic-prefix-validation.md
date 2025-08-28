---
title: Dynamic Prefix Validation with Zod
description: Use os.prefix with dynamic parameter validation using Zod schemas
---

# Dynamic Prefix Validation with Zod

oRPC supports dynamic parameter validation when using `os.prefix()` with Zod schemas. This feature allows you to validate and type-cast URL parameters automatically, providing type safety and runtime validation for your route parameters.

## Overview

The enhanced `os.prefix()` method accepts an optional argument that defines validation schemas using Zod. This provides:

- **Type Safety**: Parameters are properly typed in your handlers
- **Runtime Validation**: Automatic validation of parameter formats using Zod
- **Type Conversion**: Automatic conversion from strings to appropriate types
- **Required Parameters**: All defined parameters are required and validated before execution
- **Direct Access**: Parameters are available directly in the `params` object of handlers
- **Full Zod Power**: Leverage all Zod validation features including transforms, custom errors, and complex schemas

## Basic Usage

### Without Validation (Existing Behavior)

```ts twoslash
import { os } from '@orpc/server'

const router = os.prefix('/api/v1').router({
  health: os.handler(() => 'OK'),
  version: os.handler(() => '1.0.0'),
})
```

### With Zod Parameter Validation

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{organizationId}', {
  organizationId: z.string().uuid()
}).router({
  get: os.handler(({ params }) => {
    // params.organizationId is validated as UUID and typed as string
    // No need for fallbacks - parameter is guaranteed to exist and be valid
    return { organization: params.organizationId }
  }),
})
```

## Supported Parameter Types with Zod

### UUID Validation

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{organizationId}', {
  organizationId: z.string().uuid()
}).router({
  get: os.handler(({ params }) => {
    // organizationId must be a valid UUID
    // Type: string
    // Required: true
    return { org: params.organizationId }
  }),
})
```

### Number Validation with Coercion

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{userId}', {
  userId: z.coerce.number().int().positive()
}).router({
  get: os.handler(({ params }) => {
    // userId is converted to number and validated as positive integer
    // Type: number
    // Required: true
    return { user: params.userId }
  }),
})
```

### String Validation with Constraints

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{projectName}', {
  projectName: z.string().min(1).max(100)
}).router({
  get: os.handler(({ params }) => {
    // projectName is validated as string with length constraints
    // Type: string
    // Required: true
    return { project: params.projectName }
  }),
})
```

### Advanced String Validation

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{slug}', {
  slug: z.string()
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
    .min(3, 'Slug must be at least 3 characters')
    .max(50, 'Slug must be at most 50 characters')
}).router({
  get: os.handler(({ params }) => {
    return { slug: params.slug }
  }),
})
```

## Multiple Parameters

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{organizationId}/{userId}', {
  organizationId: z.string().uuid(),
  userId: z.coerce.number().int().positive()
}).router({
  profile: os.handler(({ params }) => {
    // Both parameters are validated and properly typed
    // No fallbacks needed - all parameters are guaranteed to exist
    return {
      organization: params.organizationId, // string (UUID)
      user: params.userId // number
    }
  }),
})
```

## Nested Prefixes

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{organizationId}', {
  organizationId: z.string().uuid()
}).router({
  users: os.prefix('/{userId}', {
    userId: z.coerce.number().int().positive()
  }).router({
    profile: os.handler(({ params }) => {
      // Both organizationId (UUID) and userId (number) are available
      // All parameters are validated and required
      return {
        organizationId: params.organizationId,
        userId: params.userId
      }
    }),
  })
})
```

## Advanced Zod Features

### Enum Validation

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{status}', {
  status: z.enum(['active', 'inactive', 'pending'])
}).router({
  get: os.handler(({ params }) => {
    // status is guaranteed to be one of: 'active', 'inactive', 'pending'
    return { status: params.status }
  }),
})
```

### Custom Transforms

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{email}', {
  email: z.string().email().transform(val => val.toLowerCase())
}).router({
  get: os.handler(({ params }) => {
    // email is validated and transformed to lowercase
    return { email: params.email }
  }),
})
```

### Union Types

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{type}', {
  type: z.union([z.literal('user'), z.literal('admin'), z.literal('guest')])
}).router({
  get: os.handler(({ params }) => {
    // type is guaranteed to be one of the literal values
    return { type: params.type }
  }),
})
```

### Optional Parameters

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{id}', {
  id: z.string().optional()
}).router({
  get: os.handler(({ params }) => {
    // id is optional, may be undefined
    return { id: params.id }
  }),
})
```

### Default Values

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{page}', {
  page: z.coerce.number().int().positive().default(1)
}).router({
  get: os.handler(({ params }) => {
    // page defaults to 1 if not provided
    return { page: params.page }
  }),
})
```

### Custom Error Messages

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{userId}', {
  userId: z.coerce.number().int().positive({
    message: 'User ID must be a positive integer'
  })
}).router({
  get: os.handler(({ params }) => {
    return { user: params.userId }
  }),
})
```

### Complex Schemas

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{user}', {
  user: z.object({
    id: z.coerce.number().int().positive(),
    name: z.string().min(1),
    email: z.string().email()
  }).transform(data => ({
    ...data,
    email: data.email.toLowerCase()
  }))
}).router({
  get: os.handler(({ params }) => {
    // user is a complex object with validation and transformation
    return { user: params.user }
  }),
})
```

## Error Handling

Invalid parameters automatically throw validation errors with detailed Zod error information:

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const router = os.prefix('/{userId}', {
  userId: z.coerce.number().int().positive()
}).router({
  get: os.handler(({ params }) => {
    return { user: params.userId }
  }),
})

// GET /invalid-number -> throws BAD_REQUEST with Zod validation error
// GET /123 -> succeeds with userId = 123
// GET / -> throws BAD_REQUEST (missing required parameter)
```

## Use Cases

### API Versioning with Organization Context

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const organizationAPI = os.prefix('/{organizationId}', {
  organizationId: z.string().uuid()
}).use(({ next, params }) => {
  // Middleware can access validated organizationId directly
  // No need to check if params exists or provide fallbacks
  const orgId = params.organizationId

  // Add organization data to context
  return next({
    context: {
      organization: { id: orgId }
    }
  })
}).router({
  users: os.router({
    list: os.handler(() => 'List organization users'),
    create: os.handler(() => 'Create user'),
  }),

  projects: os.router({
    list: os.handler(() => 'List organization projects'),
    create: os.handler(() => 'Create project'),
  })
})
```

### User-Scoped Resources with Advanced Validation

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const userAPI = os.prefix('/{userId}', {
  userId: z.coerce.number().int().positive()
}).router({
  profile: os.handler(({ params }) => {
    // userId is guaranteed to be a valid positive integer
    return { profile: `User ${params.userId} profile` }
  }),

  settings: os.handler(({ params }) => {
    // userId is guaranteed to be a valid positive integer
    return { settings: `User ${params.userId} settings` }
  }),
})
```

### Multi-Tenant Applications with Complex Validation

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

const tenantAPI = os.prefix('/{tenantId}/{userId}', {
  tenantId: z.string().uuid(),
  userId: z.coerce.number().int().positive()
}).router({
  dashboard: os.handler(({ params }) => {
    // Both parameters are guaranteed to exist and be valid
    return {
      dashboard: `Tenant ${params.tenantId} - User ${params.userId} dashboard`
    }
  }),
})
```

## Migration from Existing Code

The new API is fully backward compatible. Existing code using `os.prefix()` without validation continues to work unchanged:

```ts twoslash
import { os } from '@orpc/server'

// Existing code - no changes needed
const legacyRouter = os.prefix('/api/v1').router({
  health: os.handler(() => 'OK')
})

// Enhanced with Zod validation - new functionality
const enhancedRouter = os.prefix('/{orgId}', {
  orgId: z.string().uuid()
}).router({
  status: os.handler(({ params }) => {
    // orgId is guaranteed to be a valid UUID
    return { org: params.orgId }
  })
})
```

## Type Safety

The enhanced `os.prefix()` provides full TypeScript support with Zod inference:

```ts twoslash
import { os } from '@orpc/server'
import * as z from 'zod'

// Type-safe parameter access with Zod inference
const router = os.prefix('/{id}/{count}', {
  id: z.string().uuid(),
  count: z.coerce.number().int()
}).router({
  test: os.handler(({ params }) => {
    // TypeScript knows the exact types from Zod schemas
    const id: string = params.id // UUID string
    const count: number = params.count // number

    return { id, count }
  })
})
```

## Key Benefits

1. **No Fallbacks Required**: Since all parameters are validated before execution, you never need to provide fallback values.

2. **Type Safety**: Parameters are properly typed according to their Zod schemas with full inference.

3. **Runtime Validation**: Automatic validation ensures data integrity at the API level using Zod.

4. **Clean Handlers**: Your handler code is cleaner without parameter validation logic.

5. **Automatic Error Handling**: Invalid parameters automatically result in proper HTTP error responses with detailed Zod error information.

6. **Full Zod Power**: Leverage all Zod features including transforms, custom errors, complex schemas, and more.

7. **Type Coercion**: Automatic conversion from strings to appropriate types (e.g., `z.coerce.number()`).

8. **Custom Validation**: Define complex validation rules, custom error messages, and transformations.

## Best Practices

1. **Use appropriate Zod schemas**: Choose the right Zod validators for your parameter types and constraints.

2. **Leverage Zod features**: Use transforms, custom errors, and complex schemas when needed.

3. **No fallback handling**: Since parameters are required and validated, you can access them directly without null checks.

4. **Combine with middleware**: Use parameter validation with middleware for authentication and authorization.

5. **Nested validation**: Take advantage of nested prefixes for hierarchical resource structures.

6. **Error handling**: Let the automatic validation handle parameter errors, but provide meaningful error messages in your Zod schemas.

7. **Type coercion**: Use `z.coerce.*` for automatic type conversion when needed.

8. **Custom validation**: Create reusable Zod schemas for common validation patterns.

This feature provides a powerful way to ensure your API routes are type-safe and properly validated using the full power of Zod, making your oRPC applications more robust, maintainable, and developer-friendly.

import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import { os } from './builder'

describe('prefix with dynamic validation using Zod', () => {
  it('should support prefix without validation', () => {
    const router = os.prefix('/api/v1').router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support prefix with UUID validation using Zod', () => {
    const router = os.prefix('/{organizationId}', {
      organizationId: z.uuid(),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support prefix with number validation using Zod', () => {
    const router = os.prefix('/{userId}', {
      userId: z.coerce.number().int().positive(),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support prefix with string validation using Zod', () => {
    const router = os.prefix('/{projectName}', {
      projectName: z.string().min(1).max(100),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support prefix with multiple parameter types using Zod', () => {
    const router = os.prefix('/{organizationId}/{userId}', {
      organizationId: z.uuid(),
      userId: z.coerce.number().int().positive(),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support advanced Zod validation', () => {
    const router = os.prefix('/{slug}/{version}', {
      slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(50),
      version: z.coerce.number().int().min(1).max(999),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support enum validation using Zod', () => {
    const router = os.prefix('/{status}', {
      status: z.enum(['active', 'inactive', 'pending']),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support custom validation using Zod', () => {
    const router = os.prefix('/{email}', {
      email: z.email().transform(val => val.toLowerCase()),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support nested prefixes with Zod validation', () => {
    const router = os.prefix('/{organizationId}', {
      organizationId: z.uuid(),
    }).router({
      users: os.prefix('/{userId}', {
        userId: z.coerce.number().int().positive(),
      }).router({
        profile: os.handler(() => 'hello'),
      }),
    })

    expect(router).toBeDefined()
  })

  // Test typing - these should compile without errors
  it('should provide correct TypeScript types', () => {
    // Basic usage
    const basic = os.prefix('/api')
    expect(basic).toBeDefined()

    // With UUID validation
    const withUuid = os.prefix('/{id}', { id: z.uuid() })
    expect(withUuid).toBeDefined()

    // With number validation
    const withNumber = os.prefix('/{count}', { count: z.coerce.number().int() })
    expect(withNumber).toBeDefined()

    // With string validation
    const withString = os.prefix('/{name}', { name: z.string().min(1) })
    expect(withString).toBeDefined()

    // Multiple parameters
    const multiParam = os.prefix('/{org}/{user}', {
      org: z.uuid(),
      user: z.coerce.number().int(),
    })
    expect(multiParam).toBeDefined()

    // Advanced validation
    const advanced = os.prefix('/{slug}/{version}', {
      slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(50),
      version: z.coerce.number().int().min(1).max(999),
    })
    expect(advanced).toBeDefined()

    // Enum validation
    const enumValidation = os.prefix('/{status}', {
      status: z.enum(['active', 'inactive', 'pending']),
    })
    expect(enumValidation).toBeDefined()
  })

  it('should support complex Zod schemas', () => {
    const router = os.prefix('/{user}', {
      user: z.object({
        id: z.coerce.number().int().positive(),
        name: z.string().min(1),
        email: z.email(),
      }).transform(data => ({
        ...data,
        email: data.email.toLowerCase(),
      })),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support union types with Zod', () => {
    const router = os.prefix('/{type}', {
      type: z.union([z.literal('user'), z.literal('admin'), z.literal('guest')]),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support optional parameters with Zod', () => {
    const router = os.prefix('/{id}', {
      id: z.string().optional(),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support default values with Zod', () => {
    const router = os.prefix('/{page}', {
      page: z.coerce.number().int().positive().default(1),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support custom error messages with Zod', () => {
    const router = os.prefix('/{userId}', {
      userId: z.coerce.number().int().positive({
        message: 'User ID must be a positive integer',
      }),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support chained Zod validations', () => {
    const router = os.prefix('/{username}', {
      username: z.string()
        .min(3, 'Username must be at least 3 characters')
        .max(20, 'Username must be at most 20 characters')
        .regex(/^\w+$/, 'Username can only contain letters, numbers, and underscores')
        .transform(val => val.toLowerCase()),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support array validation with Zod', () => {
    const router = os.prefix('/{tags}', {
      tags: z.string().transform(val => val.split(',').map(tag => tag.trim())),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support date validation with Zod', () => {
    const router = os.prefix('/{date}', {
      date: z.coerce.date(),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support boolean validation with Zod', () => {
    const router = os.prefix('/{active}', {
      active: z.coerce.boolean(),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })

  it('should support multiple validation rules with Zod', () => {
    const router = os.prefix('/{password}', {
      password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/\d/, 'Password must contain at least one number')
        .regex(/[^A-Z0-9]/i, 'Password must contain at least one special character'),
    }).router({
      test: os.handler(() => 'hello'),
    })

    expect(router).toBeDefined()
  })
})

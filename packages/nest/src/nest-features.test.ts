import type { ArgumentsHost, CallHandler, CanActivate, ExceptionFilter, ExecutionContext, INestApplication, MiddlewareConsumer, NestInterceptor, NestMiddleware, PipeTransform } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { Catch, Controller, ForbiddenException, HttpException, Injectable, Module, SetMetadata, UseGuards, UseInterceptors } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { oc } from '@orpc/contract'
import { implement } from '@orpc/server'
import * as StandardServerNode from '@orpc/standard-server-node'
import { map } from 'rxjs'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { Implement, ORPCExceptionFilter, ORPCModule } from '.'

// 1. oRPC Contract
const testContract = {
  hello: oc.route({
    path: '/hello',
    method: 'POST',
  })
    .input(z.object({ name: z.string() }))
    .output(z.object({ greeting: z.string() })),
}

const testDetailedContract = {
  hello: oc.route({
    path: '/hello',
    method: 'POST',
    outputStructure: 'detailed',
  })
    .input(z.object({ name: z.string() }))
    .output(z.object({
      body: z.object({ greeting: z.string() }),
      status: z.number().optional(),
    })),
}

// Contract for testing global pipes (transformation)
const testPipeContract = {
  transform: oc.route({
    path: '/transform',
    method: 'POST',
  })
    .input(z.object({
      text: z.string(),
      name: z.string(),
    }))
    .output(z.object({ result: z.string(), original: z.string() })),
}

// Contract for testing error handling (global filters)
const testErrorContract = {
  error: oc.route({
    path: '/error',
    method: 'POST',
  })
    .input(z.object({ shouldThrow: z.boolean() }))
    .output(z.object({ message: z.string() })),
}

// Contract for testing guards
const testGuardContract = {
  protected: oc.route({
    path: '/protected',
    method: 'POST',
  })
    .input(z.object({ apiKey: z.string() }))
    .output(z.object({ message: z.string(), user: z.string() })),
}

// 2. A real controller for the 'raw' output test
@Controller()
class TestRawController {
  @Implement(testContract.hello)
  hello() {
    return implement(testContract.hello).handler(async ({ input }) => {
      // This handler ALWAYS returns the raw output shape
      return { greeting: `Hello, ${input.name}!` }
    })
  }
}

// 3. A separate controller for the 'detailed' output test
@Controller()
class TestDetailedController {
  @Implement(testDetailedContract.hello)
  hello() {
    return implement(testDetailedContract.hello).handler(async ({ input }) => {
      // This handler returns the detailed output shape: { body, headers?, status? }
      return {
        status: 201, // Custom status to verify detailed output works
        body: { greeting: `Hello, ${input.name}!` },
      }
    })
  }
}

// 4. Interceptor that modifies the response body (must be declared before controllers that use it)
@Injectable()
class ResponseTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data: any) => {
        return {
          ...data,
          intercepted: true,
          timestamp: new Date().toISOString(),
        }
      }),
    )
  }
}

// 5. Controller with interceptor to test response transformation
@Controller()
class TestInterceptorController {
  @Implement(testContract.hello)
  @UseInterceptors(ResponseTransformInterceptor)
  hello() {
    return implement(testContract.hello).handler(async ({ input }) => {
      return { greeting: `Hello, ${input.name}!` }
    })
  }
}

// 6. Controller for testing global pipes (transformation)
@Controller()
class TestPipeController {
  @Implement(testPipeContract.transform)
  transform() {
    return implement(testPipeContract.transform).handler(async ({ input }) => {
      // Input should be transformed by the global pipe before reaching this handler
      return {
        result: `Processed: ${input.text}`,
        original: `${input.name}`,
      }
    })
  }
}

// 7. Controller for testing global error filter
@Controller()
class TestErrorController {
  @Implement(testErrorContract.error)
  error() {
    return implement(testErrorContract.error).handler(async ({ input }) => {
      if (input.shouldThrow) {
        throw new HttpException('Custom error from handler', 418)
      }
      return { message: 'No error' }
    })
  }
}

// 8. Custom metadata decorator for roles (similar to your @Roles decorator)
const ROLES_KEY = 'roles'
const RequireRole = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)

// 9. Custom Guard that checks API key from request (similar to JwtAuthGuard)
@Injectable()
class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    // Simulate checking API key from headers or body
    const apiKey = request.headers['x-api-key'] || request.body?.apiKey

    if (apiKey === 'valid-key') {
      // Simulate adding user to request (like JWT strategy does)
      request.user = { id: 1, name: 'John Doe', role: 'admin' }
      return true
    }

    throw new ForbiddenException('Invalid API key')
  }
}

// 10. Simplified Guard that just checks if user exists (no Reflector needed for this test)
@Injectable()
class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (!user) {
      throw new ForbiddenException('No user found - authentication required')
    }

    return true
  }
}

// 11. Controller for testing guards (method-level)
// IMPORTANT: The @Implement interceptor passes the NestJS request/response
// as part of the oRPC context, allowing handlers to access guard modifications
// like properties set on the original request (standard practice).
// This solves the limitation where oRPC creates its own standardized request object.
@Controller()
class TestGuardController {
  @UseGuards(ApiKeyGuard, AuthenticatedGuard)
  @RequireRole('admin')
  @Implement(testGuardContract.protected)
  protected() {
    return implement(testGuardContract.protected).handler(async ({ input, context }) => {
      const req = (context as any).request
      const user = req?.user

      return {
        message: 'Access granted',
        user: user?.name || 'Unknown',
      }
    })
  }
}

// 12. Simple custom pipe that uppercases string input
@Injectable()
class UpperCasePipe implements PipeTransform {
  transform(value: any) {
    if (typeof value === 'string') {
      return value.toUpperCase()
    }
    if (typeof value === 'object' && value !== null) {
      // Transform all string properties
      const result: any = {}
      for (const key in value) {
        const val = value[key]
        result[key] = typeof val === 'string' ? val.toUpperCase() : val
      }
      return result
    }
    return value
  }
}

// 9. Global interceptor that modifies the response
@Injectable()
class GlobalLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        const res = context.switchToHttp().getResponse()
        res.header('Global-Interceptor', `global-interceptor`)
        return { ...data, globalInterceptor: true }
      }),
    )
  }
}

// 9. Global filter that catches HTTP exceptions
@Catch(HttpException)
class GlobalHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse()
    const status = exception.getStatus()

    // Custom error response format
    const errorResponse = {
      statusCode: status,
      message: exception.message,
      timestamp: new Date().toISOString(),
      customFilter: true, // Marker to verify the filter ran
    }

    response.status(status).send(errorResponse)
  }
}

// 10. Custom Middleware
class CustomHeaderMiddleware implements NestMiddleware {
  use(req: any, res: any, next: (error?: any) => void) {
    res.setHeader('X-Custom-Middleware', 'hello')
    next()
  }
}

// 10. Test Modules for each controller
@Module({
  controllers: [TestRawController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ORPCExceptionFilter,
    },
  ],
})
class TestRawModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CustomHeaderMiddleware).forRoutes('*')
  }
}

@Module({
  controllers: [TestDetailedController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ORPCExceptionFilter,
    },
  ],
})
class TestDetailedModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CustomHeaderMiddleware).forRoutes('*')
  }
}

@Module({
  controllers: [TestInterceptorController],
  providers: [
    ResponseTransformInterceptor,
    {
      provide: APP_FILTER,
      useClass: ORPCExceptionFilter,
    },
  ],
})
class TestInterceptorModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CustomHeaderMiddleware).forRoutes('*')
  }
}

@Module({
  controllers: [TestPipeController],
  providers: [
    {
      provide: APP_PIPE,
      useClass: UpperCasePipe,
    },
    {
      provide: APP_FILTER,
      useClass: ORPCExceptionFilter,
    },
  ],
})
class TestPipeModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CustomHeaderMiddleware).forRoutes('*')
  }
}

@Module({
  controllers: [TestErrorController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalHttpExceptionFilter,
    },
    // this will not run because GlobalHttpExceptionFilter sends the response first
    {
      provide: APP_FILTER,
      useClass: ORPCExceptionFilter,
    },
  ],
})
class TestErrorModule {}

@Module({
  controllers: [TestGuardController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ORPCExceptionFilter,
    },
  ],
})
class TestGuardModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CustomHeaderMiddleware).forRoutes('*')
  }
}

@Module({
  controllers: [TestRawController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: GlobalLoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: ORPCExceptionFilter,
    },
  ],
})
class TestGlobalInterceptorModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CustomHeaderMiddleware).forRoutes('*')
  }
}

const sendStandardResponseSpy = vi.spyOn(StandardServerNode, 'sendStandardResponse')

describe('oRPC Nest Middleware Integration', () => {
  const testSuite = (
    adapterName: 'Express' | 'Fastify',
    adapter: () => ExpressAdapter | FastifyAdapter,
  ) => {
    describe(`with ${adapterName}`, () => {
      let app: INestApplication

      async function createApp(testModule: any, orpcModuleConfig: any) {
        const moduleFixture = await Test.createTestingModule({
          imports: [testModule, ORPCModule.forRoot(orpcModuleConfig)],
        }).compile()

        app = moduleFixture.createNestApplication(adapter())
        app.enableCors()
        await app.init()
        if (adapterName === 'Fastify') {
          await (app as any).getHttpAdapter().getInstance().ready()
        }
      }

      afterEach(async () => {
        await app?.close()
      })

      it('should apply NestJS middleware and CORS with outputStructure: \'raw\'', async () => {
        await createApp(TestRawModule, {})

        await request(app.getHttpServer())
          .post('/hello')
          .send({ name: 'world' })
          .expect(200)
          .expect('Access-Control-Allow-Origin', '*')
          .expect('X-Custom-Middleware', 'hello')
          .then((response) => {
            expect(response.body).toEqual({ greeting: 'Hello, world!' })
          })
      })

      it('should apply NestJS middleware and CORS with outputStructure: \'detailed\'', async () => {
        await createApp(TestDetailedModule, { outputStructure: 'detailed' })

        await request(app.getHttpServer())
          .post('/hello')
          .send({ name: 'detailed-world' })
          .expect(201) // Assert the custom status code
          .expect('Access-Control-Allow-Origin', '*')
          .expect('X-Custom-Middleware', 'hello')
          .then((response) => {
            // Manually parse the response text instead of relying on response.body
            const body = JSON.parse(response.text)
            expect(body).toEqual({
              greeting: 'Hello, detailed-world!',
            })
          })
      })

      it('should allow NestJS interceptors to modify the response', async () => {
        await createApp(TestInterceptorModule, {})

        await request(app.getHttpServer())
          .post('/hello')
          .send({ name: 'interceptor-test' })
          .expect(200)
          .expect('Access-Control-Allow-Origin', '*')
          .expect('X-Custom-Middleware', 'hello')
          .then((response) => {
            expect(response.body).toMatchObject({
              greeting: 'Hello, interceptor-test!',
              intercepted: true,
            })
            expect(response.body.timestamp).toBeDefined()
          })
      })

      it('should work with global pipes (APP_PIPE provider)', async () => {
        // Note: Global NestJS pipes don't transform oRPC handler inputs because:
        // 1. oRPC has its own codec that decodes and validates the request body against
        //    the contract schema (Zod schemas) - this happens independently of NestJS pipes
        // 2. NestJS pipes are designed to work with parameter decorators (@Body(), @Param(), etc.)
        //    but oRPC handlers don't use these decorators
        // 3. The request body is parsed by NestJS, but pipe transformation only applies when
        //    explicitly bound to parameters via decorators
        //
        // For input transformation with oRPC, you should:
        // - Use Zod's .transform() in your contract schemas
        // - Use oRPC middleware to transform inputs
        // - Transform data in the handler itself
        //
        // This test verifies that global pipes can be registered without breaking oRPC.
        await createApp(TestPipeModule, {})

        await request(app.getHttpServer())
          .post('/transform')
          .send({ text: 'hello world', name: 'john' })
          .expect(200)
          .expect('Access-Control-Allow-Origin', '*')
          .expect('X-Custom-Middleware', 'hello')
          .then((response) => {
            // The input is NOT transformed by UpperCasePipe because oRPC's codec
            // processes the request body independently from NestJS's pipe system
            expect(response.body).toEqual({
              result: 'Processed: hello world',
              original: 'john',
            })
          })
      })

      it('should work with Guards and custom decorators (@UseGuards)', async () => {
        await createApp(TestGuardModule, {})

        // Test successful authentication with valid API key and admin role
        await request(app.getHttpServer())
          .post('/protected')
          .set('X-Api-Key', 'valid-key')
          .send({ apiKey: 'valid-key' })
          .expect(200)
          .expect('Access-Control-Allow-Origin', '*')
          .expect('X-Custom-Middleware', 'hello')
          .then((response) => {
            expect(response.body).toEqual({
              message: 'Access granted',
              user: 'John Doe',
            })
          })

        // Test failed authentication with invalid API key
        await request(app.getHttpServer())
          .post('/protected')
          .set('X-Api-Key', 'invalid-key')
          .send({ apiKey: 'invalid-key' })
          .expect(403)
          .then((response) => {
            expect(response.body.message).toBe('Invalid API key')
          })
      })

      it('should work with global exception filters (useGlobalFilters)', async () => {
        await createApp(TestErrorModule, {})

        // Request that doesn't throw should succeed
        await request(app.getHttpServer())
          .post('/error')
          .send({ shouldThrow: false })
          .expect(200)
          .then((response) => {
            expect(response.body).toEqual({ message: 'No error' })
          })

        // Errors thrown inside oRPC handlers are now allowed to bubble up to NestJS
        // so global exception filters can catch and transform them
        await request(app.getHttpServer())
          .post('/error')
          .send({ shouldThrow: true })
          .expect(418) // Custom status code from the HttpException
          .then((response) => {
            // The response should be transformed by GlobalHttpExceptionFilter
            expect(response.body).toMatchObject({
              statusCode: 418,
              message: 'Custom error from handler',
              customFilter: true, // Marker to verify the filter ran
            })
            expect(response.body.timestamp).toBeDefined()
          })

        // Ensure that the standard response was not sent via ORPCExceptionFilter
        expect(sendStandardResponseSpy).not.toHaveBeenCalled()
      })

      it('should work with global interceptors (useGlobalInterceptors)', async () => {
        await createApp(TestGlobalInterceptorModule, {})

        await request(app.getHttpServer())
          .post('/hello')
          .send({ name: 'global-interceptor' })
          .expect(200)
          .expect('Global-Interceptor', 'global-interceptor')
          .then((response) => {
            expect(response.body.globalInterceptor).toBe(true)
          })
      })
    })
  }

  testSuite('Express', () => new ExpressAdapter())
  testSuite('Fastify', () => new FastifyAdapter())
})

import type { CallHandler, CanActivate, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { Request as ExpressRequest } from 'express'
import type { FastifyReply } from 'fastify'
import type { NestStandardLazyRequest } from '../common/types'
import { Buffer } from 'node:buffer'
import FastifyCookie from '@fastify/cookie'
import { Controller, HttpException, Req, Res, SetMetadata, StreamableFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { meta, oc } from '@orpc/contract'
import { implement, ORPCError, os, Procedure } from '@orpc/server'
import { catchError, tap } from 'rxjs'
import supertest from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { Implement, ORPCModule } from './index'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('@Implement integration suite (RPC)', () => {
  describe('requirements', () => {
    it('should error if implemented method return invalid procedure', async () => {
      const contract = oc.meta(meta.path(['procedure']))

      @Controller()
      class ImplController {
        @Implement(contract)
        procedure(): any {
          return 'invalid'
        }
      }

      const moduleRef = await Test.createTestingModule({ controllers: [ImplController] }).compile()
      const app = moduleRef.createNestApplication()
      await app.init()

      const res = await supertest(app.getHttpServer()).post('/procedure')
      expect(res.status).toBe(500)
    })

    it('should error if nestjs handler return mismatch result', async () => {
      const routingInterceptor = vi.fn(({ next }) => next())
      const contract = oc.meta(meta.path(['procedure']))

      @Controller()
      class ImplController {
        @Implement(contract)
        procedure() {
          return implement(contract).handler(() => {})
        }
      }

      const moduleRef = await Test.createTestingModule({
        controllers: [ImplController],
        imports: [ORPCModule.forRoot({ routingInterceptors: [routingInterceptor] })],
      }).compile()

      const app = moduleRef.createNestApplication()
      await app.init()

      routingInterceptor.mockResolvedValueOnce({ matched: false })
      const res = await supertest(app.getHttpServer()).post('/procedure')
      expect(res.status).toBe(500)
    })
  })

  describe('routing', () => {
    const contract = {
      staticPath: oc.meta(meta.path(['static', 'path'])),
      dynamicPath: oc.meta(meta.path(['dynamic', 'value'])).input(z.object({ param: z.string() })),
      restPath: oc.meta(meta.path(['rest', 'some', 'long', 'path'])).input(z.object({ rest: z.string() })),
      prefixedPath: oc.meta(meta.path(['prefix', 'static'])),
      dynamicPrefix: oc.meta(meta.path(['dynamic-prefix', 'value', 'static'])).input(z.object({ prefix: z.string() })),
      specialPath: oc.meta(meta.path(['special', 'path', 'test'])).input(z.object({ params: z.array(z.string()) })),
    }

    @Controller()
    class ProcedureController {
      @Implement(contract.staticPath)
      staticPath() {
        return implement(contract.staticPath).handler(() => 'static')
      }

      @Implement(contract.dynamicPath)
      dynamicPath() {
        return implement(contract.dynamicPath).handler(({ input }) => `param: ${input.param}`)
      }

      @Implement(contract.restPath)
      restPath() {
        return implement(contract.restPath).handler(({ input }) => `rest: ${input.rest}`)
      }

      @Implement(contract.prefixedPath)
      prefixedPath() {
        return implement(contract.prefixedPath).handler(() => `prefixed path`)
      }

      @Implement(contract.dynamicPrefix)
      dynamicPrefix() {
        return implement(contract.dynamicPrefix).handler(({ input }) => `prefix: ${input.prefix}`)
      }

      @Implement(contract.specialPath)
      specialPath() {
        return implement(contract.specialPath).handler(({ input }) => `params: ${input.params}`)
      }
    }

    @Controller()
    class RouterController {
      @Implement(contract)
      router() {
        return {
          staticPath: implement(contract.staticPath).handler(() => 'static'),
          dynamicPath: implement(contract.dynamicPath).handler(({ input }) => `param: ${input.param}`),
          restPath: implement(contract.restPath).handler(({ input }) => `rest: ${input.rest}`),
          prefixedPath: implement(contract.prefixedPath).handler(() => `prefixed path`),
          dynamicPrefix: implement(contract.dynamicPrefix).handler(({ input }) => `prefix: ${input.prefix}`),
          specialPath: implement(contract.specialPath).handler(({ input }) => `params: ${input.params}`),
        }
      }
    }

    describe.each([
      ['procedure-based implementation controller', ProcedureController],
      ['router-based implementation controller', RouterController],
    ] as const)('with %s', (_, ControllerClass) => {
      describe.each([
        ['express adapter', undefined],
        ['fastify adapter', new FastifyAdapter()],
      ] as const)('with %s', async (__, adapter) => {
        const moduleRef = await Test.createTestingModule({ controllers: [ControllerClass] }).compile()
        const app = adapter ? moduleRef.createNestApplication(adapter) : moduleRef.createNestApplication()
        await app.init()

        if (adapter) {
          await app.getHttpAdapter().getInstance().ready()
        }

        it('should handle static path', async () => {
          const res = await supertest(app.getHttpServer()).post('/static/path')
          expect(res.statusCode).toEqual(200)
          expect(res.body).toEqual({ json: 'static' })
        })

        it('should handle dynamic path', async () => {
          const res = await supertest(app.getHttpServer()).post('/dynamic/value').send({ json: { param: 'value' } })
          expect(res.statusCode).toEqual(200)
          expect(res.body).toEqual({ json: 'param: value' })
        })

        it('should handle rest path', async () => {
          const res = await supertest(app.getHttpServer()).post('/rest/some/long/path').send({ json: { rest: 'some/long/path' } })
          expect(res.statusCode).toEqual(200)
          expect(res.body).toEqual({ json: 'rest: some/long/path' })
        })

        it('should handle prefixed path', async () => {
          const res = await supertest(app.getHttpServer()).post('/prefix/static')
          expect(res.statusCode).toEqual(200)
          expect(res.body).toEqual({ json: 'prefixed path' })
        })

        it('should handle dynamic prefix path', async () => {
          const res = await supertest(app.getHttpServer()).post('/dynamic-prefix/value/static').send({ json: { prefix: 'value' } })
          expect(res.statusCode).toEqual(200)
          expect(res.body).toEqual({ json: 'prefix: value' })
        })

        it('should handle special procedure path', async () => {
          const res = await supertest(app.getHttpServer()).post('/special/path/test').send({ json: { params: ['a', 'b', 'c'] } })
          expect(res.statusCode).toEqual(200)
          expect(res.body).toEqual({ json: 'params: a,b,c' })
        })

        it('should return 404 for unknown path', async () => {
          const res = await supertest(app.getHttpServer()).post('/unknown/path')
          expect(res.statusCode).toEqual(404)
        })
      })
    })

    describe.each([
      ['express adapter', undefined],
      ['fastify adapter', new FastifyAdapter()],
    ] as const)('params edge cases with %s', async (_, adapter) => {
      const contract = {
        staticPath: oc.meta(meta.path(['static'])).input(z.object({ tenant: z.string() })),
        dynamicPath: oc.meta(meta.path(['dynamic', '123'])).input(z.object({ tenant: z.string(), id: z.string() })),
        restPath: oc.meta(meta.path(['rest', 'some', 'long', 'path'])).input(z.object({ tenant: z.string(), rest: z.string() })),
        pathNamedParam: oc.meta(meta.path(['files', 'xxx'])).input(z.object({ tenant: z.string(), path: z.string() })),
      }

      @Controller('/:tenant')
      class TenantController {
        @Implement(contract.staticPath)
        staticPath() {
          return implement(contract.staticPath).handler(({ input }) => input)
        }

        @Implement(contract.dynamicPath)
        dynamicPath() {
          return implement(contract.dynamicPath).handler(({ input }) => input)
        }

        @Implement(contract.restPath)
        restPath() {
          return implement(contract.restPath).handler(({ input }) => input)
        }

        @Implement(contract.pathNamedParam)
        pathNamedParam() {
          return implement(contract.pathNamedParam).handler(({ input }) => input)
        }
      }

      const protoContract = oc.meta(meta.path(['proto', 'some', 'value'])).input(z.object({ params: z.record(z.string(), z.string()).optional() }))

      @Controller()
      class ProtoController {
        @Implement(protoContract)
        proto() {
          return implement(protoContract).handler(({ input }) => {
            const params = input.params ?? {}
            return {
              entries: Object.entries(params),
              constructor: typeof params.constructor,
            }
          })
        }
      }

      const moduleRef = await Test.createTestingModule({
        controllers: [TenantController, ProtoController],
      }).compile()

      const app = adapter ? moduleRef.createNestApplication(adapter) : moduleRef.createNestApplication()
      await app.init()

      if (adapter) {
        await app.getHttpAdapter().getInstance().ready()
      }

      it('should keep dynamic controller prefix params when the contract path has none', async () => {
        const res = await supertest(app.getHttpServer()).post('/acme/static').send({ json: { tenant: 'acme' } })
        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual({ json: { tenant: 'acme' } })
      })

      it('should keep dynamic controller prefix params alongside contract params', async () => {
        const res = await supertest(app.getHttpServer()).post('/acme/dynamic/123').send({ json: { tenant: 'acme', id: '123' } })
        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual({ json: { tenant: 'acme', id: '123' } })
      })

      it('should keep dynamic controller prefix params alongside contract rest params', async () => {
        const res = await supertest(app.getHttpServer()).post('/acme/rest/some/long/path').send({ json: { tenant: 'acme', rest: 'some/long/path' } })
        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual({ json: { tenant: 'acme', rest: 'some/long/path' } })
      })

      it('should keep a non-rest param literally named `path`', async () => {
        const res = await supertest(app.getHttpServer()).post('/acme/files/xxx').send({ json: { tenant: 'acme', path: 'xxx' } })
        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual({ json: { tenant: 'acme', path: 'xxx' } })
      })

      it('should treat params named like `__proto__` as own properties without polluting the prototype', async () => {
        const res = await supertest(app.getHttpServer()).post('/proto/some/value').send({ json: {} })
        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual({ json: { entries: [], constructor: 'function' } })
      })
    })
  })

  describe('response status, headers and body should follow standardserver', () => {
    const contract = oc.meta(meta.path(['response']))

    const handler = vi.fn()

    @Controller()
    class ImplController {
      @Implement(contract)
      response() {
        return implement(contract).handler(handler)
      }
    }

    describe.each([
      ['express adapter', undefined],
      ['fastify adapter', new FastifyAdapter()],
    ] as const)('with %s', async (_, adapter) => {
      const routingInterceptor = vi.fn(({ next }) => next())
      const moduleRef = await Test.createTestingModule({
        controllers: [ImplController],
        imports: [ORPCModule.forRoot({ routingInterceptors: [routingInterceptor] })],
      }).compile()

      const returnedValueSPy = vi.fn()
      const app = adapter ? moduleRef.createNestApplication(adapter) : moduleRef.createNestApplication()
      app.useGlobalInterceptors(new class implements NestInterceptor {
        intercept(ctx: ExecutionContext, next: CallHandler) {
          return next.handle().pipe(tap(value => returnedValueSPy(value)))
        }
      }())
      await app.init()

      if (adapter) {
        await app.getHttpAdapter().getInstance().ready()
      }

      it('should response with output status', async () => {
        handler.mockReset()
        handler
          .mockResolvedValueOnce({ status: 202 })
          .mockResolvedValueOnce({ status: 203 })

        await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.body).toEqual({ json: { status: 202 } })
          return true
        })

        await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.body).toEqual({ json: { status: 203 } })
          return true
        })
      })

      it('should response with output headers', async () => {
        handler.mockReset()
        handler.mockResolvedValueOnce({ headers: {
          'x-custom': 'value',
          'set-cookie': ['cookie1=value1', 'cookie2=value2'],
          'x-undefined': undefined,
        } })

        await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.body).toEqual({ json: { headers: { 'x-custom': 'value', 'set-cookie': ['cookie1=value1', 'cookie2=value2'] } } })
          return true
        })
      })

      describe('response body', () => {
        beforeEach(() => {
          handler.mockReset()
        })

        it('should handle undefined body as empty', async () => {
          handler.mockResolvedValueOnce(undefined)

          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['standard-server']).toBeUndefined()
            expect(res.text).toEqual('')

            expect(returnedValueSPy).toHaveBeenCalledWith(undefined)
            return true
          })
        })

        it('should handle primitive, array and object as JSON and wrap in { json: ... }', async () => {
          handler.mockResolvedValueOnce('string')
          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['standard-server']).toBeUndefined()
            expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
            expect(res.text).toEqual('{"json":"string"}')
            return true
          })

          handler.mockResolvedValueOnce(null)
          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['standard-server']).toBeUndefined()
            expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
            expect(res.text).toEqual('{"json":null}')
            return true
          })

          handler.mockResolvedValueOnce(true)
          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['standard-server']).toBeUndefined()
            expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
            expect(res.text).toEqual('{"json":true}')

            expect(returnedValueSPy).toHaveBeenCalledWith({ json: true, meta: undefined })
            return true
          })

          handler.mockResolvedValueOnce(123)
          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['standard-server']).toBeUndefined()
            expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
            expect(res.text).toEqual('{"json":123}')

            expect(returnedValueSPy).toHaveBeenCalledWith({ json: 123, meta: undefined })
            return true
          })

          handler.mockResolvedValueOnce([1, 2, 3])
          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['standard-server']).toBeUndefined()
            expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
            expect(res.text).toEqual('{"json":[1,2,3]}')

            expect(returnedValueSPy).toHaveBeenCalledWith({ json: [1, 2, 3], meta: undefined })
            return true
          })

          handler.mockResolvedValueOnce({ a: 1, b: 2 })
          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['standard-server']).toBeUndefined()
            expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
            expect(res.text).toEqual('{"json":{"a":1,"b":2}}')

            expect(returnedValueSPy).toHaveBeenCalledWith({ json: { a: 1, b: 2 }, meta: undefined })
            return true
          })
        })

        it('should handle Blob and File as StreamableFile and can override auto-generated content-disposition', async () => {
          const blob = new Blob(['blob content'], { type: 'application/pdf' })
          const file = new File(['file content'], 'test.pdf', { type: 'application/pdf' })

          handler.mockResolvedValueOnce(blob)
          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['content-type']).toEqual('application/pdf')
            expect(res.header['content-length']).toEqual(blob.size.toString())
            expect(res.body).toEqual(Buffer.from('blob content'))

            expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))
            return true
          })

          handler.mockResolvedValueOnce(file)
          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['content-type']).toEqual('application/pdf')
            expect(res.header['content-length']).toEqual(file.size.toString())
            expect(res.body).toEqual(Buffer.from('file content'))

            expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))
            return true
          })
        })

        it('should handle URLSearchParams as text application/x-www-form-urlencoded', async () => {
          routingInterceptor.mockResolvedValueOnce({
            matched: true,
            response: { status: 200, headers: {}, body: new URLSearchParams('a=4') },
          })

          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.headers['standard-server']).toBeUndefined()
            expect(res.headers['content-type']).toContain('application/x-www-form-urlencoded')
            expect(res.text).toEqual('a=4')

            expect(returnedValueSPy).toHaveBeenCalledWith('a=4')
            return true
          })
        })

        it('should handle FormData as StreamableFile multipart/form-data', async () => {
          handler.mockResolvedValueOnce({ number: 1, blob: new Blob(['blob']) })

          const res = await supertest(app.getHttpServer())
            .post('/response')
            .buffer(true)
            .parse((res, callback) => {
              const chunks: Buffer[] = []
              res.on('data', chunk => chunks.push(Buffer.from(chunk)))
              res.on('end', () => callback(null, Buffer.concat(chunks)))
              res.on('error', err => callback(err, undefined))
            })

          expect(res.statusCode).toEqual(200)
          expect(res.headers['content-type']).toMatch(/multipart\/form-data|application\/json/)
        })

        it('should stream ReadableStream and can override content-type', async () => {
          handler.mockResolvedValueOnce(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(new TextEncoder().encode('chunk1'))
                controller.enqueue(new TextEncoder().encode(' chunk2'))
                controller.enqueue(new TextEncoder().encode(' chunk3'))
                controller.close()
              },
            }),
          )

          await expect(supertest(app.getHttpServer()).post('/response')).resolves.toSatisfy((res) => {
            expect(res.statusCode).toEqual(200)
            expect(res.body).toEqual(Buffer.from('chunk1 chunk2 chunk3'))

            expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))
            return true
          })
        })

        it('should stream event stream', async () => {
          handler.mockResolvedValueOnce(
            (async function* () {
              yield 'chunk1'
              yield 'chunk2'
              yield 'chunk3'
            }()),
          )

          const res = await supertest(app.getHttpServer())
            .post('/response')
            .buffer(true)
            .parse((res, callback) => {
              const chunks: Buffer[] = []
              res.on('data', chunk => chunks.push(Buffer.from(chunk)))
              res.on('end', () => callback(null, Buffer.concat(chunks)))
              res.on('error', err => callback(err, undefined))
            })

          expect(res.statusCode).toEqual(200)
          expect(res.body).toSatisfy(Buffer.isBuffer)

          expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))
        })
      })
    })
  })

  describe('error handling', () => {
    const contract = oc.meta(meta.path(['error']))

    const handler = vi.fn()

    @Controller()
    class ImplController {
      @Implement(contract)
      error() {
        return implement(contract).handler(handler)
      }
    }

    describe.each([
      ['express adapter', undefined],
      ['fastify adapter', new FastifyAdapter()],
    ] as const)('with %s', async (_, adapter) => {
      const routingInterceptor = vi.fn(({ next }) => next())
      const moduleRef = await Test.createTestingModule({
        controllers: [ImplController],
        imports: [ORPCModule.forRoot({ routingInterceptors: [routingInterceptor] })],
      }).compile()

      const catchErrorSpy = vi.fn((error) => {
        throw error
      })
      const app = adapter ? moduleRef.createNestApplication(adapter) : moduleRef.createNestApplication()
      app.useGlobalInterceptors(new class implements NestInterceptor {
        intercept(ctx: ExecutionContext, next: CallHandler<any>) {
          return next.handle().pipe(catchError(error => catchErrorSpy(error)))
        }
      }())
      await app.init()

      if (adapter) {
        await app.getHttpAdapter().getInstance().ready()
      }

      it('should throw HttpException for regular errors', async () => {
        const error = new ORPCError('NOT_FOUND', { data: 'test data' })
        handler.mockRejectedValueOnce(error)

        const res = await supertest(app.getHttpServer()).post('/error')

        expect(res.statusCode).toEqual(404)
        expect(res.body).toEqual({ json: error.toJSON(), meta: undefined })

        expect(catchErrorSpy).toHaveBeenCalledTimes(1)
        expect(catchErrorSpy).toHaveBeenCalledWith(new HttpException({ json: error.toJSON(), meta: undefined }, 404))
      })

      it('should throw INTERNAL_SERVER_ERROR for non-ORPCError', async () => {
        const error = new Error('test error')
        handler.mockRejectedValueOnce(error)

        const res = await supertest(app.getHttpServer()).post('/error')

        const expectedError = new ORPCError('INTERNAL_SERVER_ERROR')
        expect(res.statusCode).toEqual(500)
        expect(res.body).toEqual({ json: expectedError.toJSON(), meta: undefined })

        expect(catchErrorSpy).toHaveBeenCalledTimes(1)
        expect(catchErrorSpy).toHaveBeenCalledWith(new HttpException({ json: expectedError.toJSON(), meta: undefined }, 500))
      })

      it('should not throw for special responses because HttpException only accepts JSON objects', async () => {
        routingInterceptor.mockResolvedValueOnce({
          matched: true,
          response: {
            status: 502,
            headers: {},
            body: new Blob(['test'], { type: 'text/plain' }),
          },
        }).mockResolvedValueOnce({
          matched: true,
          response: {
            status: 502,
            headers: {},
            body: 'text',
          },
        })

        await expect(supertest(app.getHttpServer()).post('/error')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(502)
          expect(res.text).toEqual('test')
          expect(res.headers['content-type']).toEqual('text/plain')
          return true
        })

        await expect(supertest(app.getHttpServer()).post('/error')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(502)
          expect(res.text).toEqual('"text"')
          expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
          return true
        })

        expect(catchErrorSpy).toHaveBeenCalledTimes(0)
      })
    })
  })

  describe('compatibility', () => {
    it('procedure-based implementation controller can access injected dependencies', async () => {
      const contract = oc.meta(meta.path(['injection']))
      let req: ExpressRequest

      @Controller()
      class ImplController {
        @Implement(contract)
        injection(@Req() request: ExpressRequest) {
          return implement(contract).handler(() => {
            req = request
          })
        }
      }

      const moduleRef = await Test.createTestingModule({ controllers: [ImplController] }).compile()
      const app = moduleRef.createNestApplication()
      await app.init()

      const res = await supertest(app.getHttpServer()).post('/injection')
      expect(res.status).toBe(200)

      expect(req!.method).toBe('POST')
      expect(req!.url).toBe('/injection')
    })

    it('router-based implementation controller can access injected dependencies', async () => {
      const contract = oc.meta(meta.path(['injection']))
      let req: ExpressRequest

      @Controller()
      class ImplController {
        @Implement({ contract })
        injection(@Req() request: ExpressRequest) {
          return {
            contract: implement(contract).handler(() => {
              req = request
            }),
          }
        }
      }

      const moduleRef = await Test.createTestingModule({ controllers: [ImplController] }).compile()
      const app = moduleRef.createNestApplication()
      await app.init()

      const res = await supertest(app.getHttpServer()).post('/injection')
      expect(res.status).toBe(200)

      expect(req!.method).toBe('POST')
      expect(req!.url).toBe('/injection')
    })

    it('router-based implementation controller can handle conflict method names and reflect all metadata on new methods regardless of decorator order', async () => {
      const contract = {
        ping: oc.meta(meta.path(['ping'])),
        pong: oc.meta(meta.path(['pong'])),
      }

      const Meta = (key: string): MethodDecorator => (target, propertyKey) => {
        Reflect.defineMetadata(key, 'value', target, propertyKey)
      }

      const handlerMeta = vi.fn()

      class MetaGuard implements CanActivate {
        canActivate(ctx: ExecutionContext) {
          const reflector = new Reflector()
          handlerMeta(reflector.get('above', ctx.getHandler()), reflector.get('below', ctx.getHandler()))
          return true
        }
      }

      @Controller()
      @UseGuards(MetaGuard)
      class ImplController {
        @SetMetadata('above', 'above-value')
        @Meta('orpc:above')
        @Implement(contract)
        @Meta('orpc:below')
        @SetMetadata('below', 'below-value')
        router(@Req() req: ExpressRequest) {
          return {
            ping: implement(contract.ping).handler(() => `ping:${req.url}`),
            pong: implement(contract.pong).handler(() => `pong:${req.url}`),
          }
        }

        router_ping() {}
        router_ping_0() {}
        router_ping_1() {}
      }

      const moduleRef = await Test.createTestingModule({ controllers: [ImplController] }).compile()
      const app = moduleRef.createNestApplication()
      await app.init()

      const pingRes = await supertest(app.getHttpServer()).post('/ping')
      expect(pingRes.status).toBe(200)
      expect(pingRes.body).toEqual({ json: 'ping:/ping' })

      const pongRes = await supertest(app.getHttpServer()).post('/pong')
      expect(pongRes.status).toBe(200)
      expect(pongRes.body).toEqual({ json: 'pong:/pong' })

      expect(handlerMeta).toHaveBeenCalledTimes(2)
      expect(handlerMeta).toHaveBeenNthCalledWith(1, 'above-value', 'below-value')
      expect(handlerMeta).toHaveBeenNthCalledWith(2, 'above-value', 'below-value')

      const controller = app.get(ImplController)

      for (const key of ['orpc:above', 'orpc:below']) {
        expect(Reflect.getMetadata(key, controller, 'router_ping_2')).toEqual('value')
        expect(Reflect.getMetadata(key, controller, 'router_pong')).toEqual('value')
      }
    })

    describe('router-based implementation applies method-level guards to synthesized methods', () => {
      const contract = {
        ping: oc.meta(meta.path(['guarded', 'ping'])),
        nested: {
          pong: oc.meta(meta.path(['guarded', 'pong'])),
        },
      }

      const canActivate = vi.fn((ctx: ExecutionContext) => {
        return ctx.switchToHttp().getRequest().headers.authorization === 'valid-token'
      })

      class AuthGuard implements CanActivate {
        canActivate = canActivate
      }

      const router = () => ({
        ping: implement(contract.ping).handler(() => {}),
        nested: {
          pong: implement(contract.nested.pong).handler(() => {}),
        },
      })

      @Controller()
      class GuardAboveController {
        @UseGuards(AuthGuard)
        @Implement(contract)
        router() {
          return router()
        }
      }

      @Controller()
      class GuardBelowController {
        @Implement(contract)
        @UseGuards(AuthGuard)
        router() {
          return router()
        }
      }

      describe.each([
        [GuardAboveController, '@UseGuards above @Implement'],
        [GuardBelowController, '@UseGuards below @Implement'],
      ] as const)('order: $1', async (ControllerClass, _) => {
        const moduleRef = await Test.createTestingModule({ controllers: [ControllerClass] }).compile()
        const app = moduleRef.createNestApplication()
        await app.init()

        it('rejects or allows based on the request header', async () => {
          expect((await supertest(app.getHttpServer()).post('/guarded/ping')).status).toBe(403)
          expect((await supertest(app.getHttpServer()).post('/guarded/pong')).status).toBe(403)

          expect((await supertest(app.getHttpServer()).post('/guarded/ping').set('authorization', 'valid-token')).status).toBe(200)
          expect((await supertest(app.getHttpServer()).post('/guarded/pong').set('authorization', 'valid-token')).status).toBe(200)

          expect(canActivate).toHaveBeenCalledTimes(4)
        })
      })
    })

    describe('router-based implementation applies method-level interceptors to synthesized methods', () => {
      const contract = {
        ping: oc.meta(meta.path(['intercepted', 'ping'])),
        nested: {
          pong: oc.meta(meta.path(['intercepted', 'pong'])),
        },
      }

      const intercepted: unknown[] = []

      beforeEach(() => {
        intercepted.length = 0
      })

      const intercept = vi.fn((ctx: ExecutionContext, next: CallHandler) => {
        return next.handle().pipe(tap(value => intercepted.push(value)))
      })

      class SpyInterceptor implements NestInterceptor {
        intercept = intercept
      }

      const router = () => ({
        ping: implement(contract.ping).handler(() => 'pong'),
        nested: {
          pong: implement(contract.nested.pong).handler(() => 'peng'),
        },
      })

      @Controller()
      class InterceptorAboveController {
        @UseInterceptors(SpyInterceptor)
        @Implement(contract)
        router() {
          return router()
        }
      }

      @Controller()
      class InterceptorBelowController {
        @Implement(contract)
        @UseInterceptors(SpyInterceptor)
        router() {
          return router()
        }
      }

      describe.each([
        [InterceptorAboveController, '@UseInterceptors above @Implement'],
        [InterceptorBelowController, '@UseInterceptors below @Implement'],
      ] as const)('order: $1', async (ControllerClass, order) => {
        const moduleRef = await Test.createTestingModule({ controllers: [ControllerClass] }).compile()
        const app = moduleRef.createNestApplication()
        await app.init()

        it('runs the interceptor on synthesized methods following decorator order', async () => {
          const pingRes = await supertest(app.getHttpServer()).post('/intercepted/ping')
          expect(pingRes.status).toBe(200)
          expect(pingRes.body).toEqual({ json: 'pong' })

          const pongRes = await supertest(app.getHttpServer()).post('/intercepted/pong')
          expect(pongRes.status).toBe(200)
          expect(pongRes.body).toEqual({ json: 'peng' })

          expect(intercept).toHaveBeenCalledTimes(2)

          if (order === '@UseInterceptors above @Implement') {
            expect(intercepted).toHaveLength(2)
            intercepted.forEach(value => expect(value).toBeInstanceOf(Procedure))
          }
          else {
            expect(intercepted).toEqual([
              { json: 'pong', meta: undefined },
              { json: 'peng', meta: undefined },
            ])
          }
        })
      })
    })

    describe('procedure-based implementation applies method-level interceptors following decorator order', () => {
      const contract = oc.meta(meta.path(['intercepted', 'procedure']))

      const intercepted: unknown[] = []

      beforeEach(() => {
        intercepted.length = 0
      })

      const intercept = vi.fn((ctx: ExecutionContext, next: CallHandler) => {
        return next.handle().pipe(tap(value => intercepted.push(value)))
      })

      class SpyInterceptor implements NestInterceptor {
        intercept = intercept
      }

      @Controller()
      class InterceptorAboveController {
        @UseInterceptors(SpyInterceptor)
        @Implement(contract)
        procedure() {
          return implement(contract).handler(() => 'pong')
        }
      }

      @Controller()
      class InterceptorBelowController {
        @Implement(contract)
        @UseInterceptors(SpyInterceptor)
        procedure() {
          return implement(contract).handler(() => 'pong')
        }
      }

      describe.each([
        [InterceptorAboveController, '@UseInterceptors above @Implement'],
        [InterceptorBelowController, '@UseInterceptors below @Implement'],
      ] as const)('order: $1', async (ControllerClass, order) => {
        const moduleRef = await Test.createTestingModule({ controllers: [ControllerClass] }).compile()
        const app = moduleRef.createNestApplication()
        await app.init()

        it('runs the interceptor following decorator order', async () => {
          const res = await supertest(app.getHttpServer()).post('/intercepted/procedure')
          expect(res.status).toBe(200)
          expect(res.body).toEqual({ json: 'pong' })

          expect(intercept).toHaveBeenCalledTimes(1)

          if (order === '@UseInterceptors above @Implement') {
            expect(intercepted).toHaveLength(1)
            expect(intercepted[0]).toBeInstanceOf(Procedure)
          }
          else {
            expect(intercepted).toEqual([{ json: 'pong', meta: undefined }])
          }
        })
      })
    })

    it('should support lazy router/procedure in router-based implementation controller', async () => {
      const contract = oc.meta(meta.path(['lazy']))

      @Controller()
      class ImplController {
        @Implement({ lazy: { contract } })
        injection() {
          return {
            lazy: os.lazy(async () => ({
              default: {
                contract: os.lazy(() => Promise.resolve({
                  default: implement(contract).handler(() => { }),
                })),
              },
            })),
          }
        }
      }

      const moduleRef = await Test.createTestingModule({ controllers: [ImplController] }).compile()
      const app = moduleRef.createNestApplication()
      await app.init()

      const res = await supertest(app.getHttpServer()).post('/lazy')
      expect(res.status).toBe(200)
    })

    it('can custom request parser with toNestStandardLazyRequest option', async () => {
      const contract = oc.meta(meta.path(['parser', 'value'])).input(z.object({ body: z.string(), params: z.object({ param: z.string() }) }))

      @Controller()
      class ImplController {
        @Implement(contract)
        moduleConfig() {
          return implement(contract).handler(({ input }) => input)
        }
      }

      const toNestStandardLazyRequest = vi.fn(() => ({
        url: '/parser/value',
        method: 'POST',
        headers: {},
        resolveBody: async () => ({ json: { body: '__OVERRIDED__', params: { param: '__PARAM__' } } }),
        params: { param: '__PARAM__' },
      } satisfies NestStandardLazyRequest))

      const moduleRef = await Test.createTestingModule({
        controllers: [ImplController],
        imports: [ORPCModule.forRoot({ toNestStandardLazyRequest })],
      }).compile()

      const app = moduleRef.createNestApplication()
      await app.init()

      const res = await supertest(app.getHttpServer()).post('/parser/value')

      expect(res.statusCode).toEqual(200)
      expect(res.body).toEqual({ json: { body: '__OVERRIDED__', params: { param: '__PARAM__' } } })

      expect(toNestStandardLazyRequest).toHaveBeenCalledTimes(1)
      expect(toNestStandardLazyRequest).toHaveBeenCalledWith(
        expect.objectContaining({ url: '/parser/value' }),
        expect.objectContaining({ end: expect.any(Function) }),
      )
    })

    it('ignores contract rest params when custom request parser provides no wildcard param', async () => {
      const contract = oc.meta(meta.path(['parser-rest', 'some', 'value'])).input(z.object({ params: z.object({ other: z.string() }) }))

      @Controller()
      class ImplController {
        @Implement(contract)
        parserRest() {
          return implement(contract).handler(({ input }) => input.params)
        }
      }

      const moduleRef = await Test.createTestingModule({
        controllers: [ImplController],
        imports: [
          ORPCModule.forRoot({
            toNestStandardLazyRequest: () => ({
              url: '/parser-rest/some/value',
              method: 'POST',
              headers: {},
              resolveBody: async () => ({ json: { params: { other: '__OTHER__' } } }),
              params: { other: '__OTHER__' },
            } satisfies NestStandardLazyRequest),
          }),
        ],
      }).compile()

      const app = moduleRef.createNestApplication()
      await app.init()

      const res = await supertest(app.getHttpServer()).post('/parser-rest/some/value')

      expect(res.statusCode).toEqual(200)
      expect(res.body).toEqual({ json: { other: '__OTHER__' } })
    })

    it('procedure path[] should use meta.path or fall back to empty', async () => {
      const contract = {
        without: oc,
        with: oc.meta(meta.path(['use', 'this', 'path'])),
      }

      @Controller()
      class ImplController {
        @Implement(contract)
        path() {
          return {
            without: implement(contract.without).handler(({ path }) => path),
            with: implement(contract.with).handler(({ path }) => path),
          }
        }
      }

      const interceptor = vi.fn(({ next }) => next())

      const moduleRef = await Test.createTestingModule({
        controllers: [ImplController],
        imports: [ORPCModule.forRoot({ interceptors: [interceptor] })],
      }).compile()

      const app = moduleRef.createNestApplication()
      await app.init()

      const res1 = await supertest(app.getHttpServer()).post('/without')
      expect(res1.status).toEqual(200)
      expect(res1.body).toEqual({ json: [] })

      const res2 = await supertest(app.getHttpServer()).post('/use/this/path')
      expect(res2.status).toEqual(200)
      expect(res2.body).toEqual({ json: ['use', 'this', 'path'] })

      expect(interceptor).toHaveBeenCalledTimes(2)
      expect(interceptor).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: [] }))
      expect(interceptor).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: ['use', 'this', 'path'] }))
    })

    it('should work with Fastify cookie plugin', async () => {
      const contract = oc.meta(meta.path(['cookie'])).input(z.object({ cookie: z.string() }))

      @Controller()
      class ImplController {
        @Implement(contract)
        cookie(@Res({ passthrough: true }) reply: FastifyReply) {
          return implement(contract).handler(({ input }) => {
            reply.setCookie('cookie', input.cookie)
            return {
              cookie: input.cookie,
            }
          })
        }
      }

      const moduleRef = await Test.createTestingModule({ controllers: [ImplController] }).compile()
      const adapter = new FastifyAdapter()
      adapter.register(FastifyCookie as any)
      const app = moduleRef.createNestApplication(adapter)
      await app.init()
      await app.getHttpAdapter().getInstance().ready()

      const res = await supertest(app.getHttpServer()).post('/cookie').send({ json: { cookie: 'test' } })

      expect(res.status).toBe(200)
      expect(res.headers['set-cookie']).toBeDefined()
      expect(res.headers['set-cookie']![0]).toContain('cookie=test')
      expect(res.body).toEqual({ json: { cookie: 'test' } })

      await app.close()
    })
  })
})

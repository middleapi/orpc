import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { Request as ExpressRequest } from 'express'
import type { FastifyReply } from 'fastify'
import type { NestStandardLazyRequest } from './module'
import { Buffer } from 'node:buffer'
import FastifyCookie from '@fastify/cookie'
import { Controller, HttpException, Req, Res, StreamableFile } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { meta, oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { implement, ORPCError, os } from '@orpc/server'
import { getOrBind } from '@orpc/shared'
import { catchError, tap } from 'rxjs'
import supertest from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { Implement } from './implement'
import { ORPCModule } from './module'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requirements', () => {
  it('should throw if @Implement is used on a non-path contract', () => {
    const contract = oc.meta(openapi({
      method: 'GET',
    }))

    expect(() => {
      @Controller()
      class ImplController {
        @Implement(contract)
        nonPath() {
          return implement(contract).handler(() => {})
        }
      }
    }).toThrow(/openapi\.path/)
  })

  it('should error if implemented method return invalid procedure', async () => {
    const contract = oc.meta(openapi({
      path: '/procedure',
    }))

    @Controller()
    class ImplController {
      @Implement(contract)
      procedure() {
        return 'invalid' as any
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer()).post('/procedure')
    expect(res.status).toBe(500)
  })

  it('should error if nestjs handler return mismatch result', async () => {
    const routingInterceptor = vi.fn(({ next }) => next())
    const contract = oc.meta(openapi({
      path: '/procedure',
    }))

    @Controller()
    class ImplController {
      @Implement(contract)
      procedure() {
        return implement(contract).handler(() => {})
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
      imports: [
        ORPCModule.forRoot({
          routingInterceptors: [routingInterceptor],
        }),
      ],
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
    staticPath: oc.meta(openapi({
      path: '/static/path',
      method: 'GET',
    })),

    dynamicPath: oc.meta(openapi({
      path: '/dynamic/{param}',
      method: 'GET',
    })).input(z.object({ param: z.string() })),

    restPath: oc.meta(openapi({
      path: '/rest/{+rest}',
      method: 'GET',
    })).input(z.object({ rest: z.string() })),

    prefixedPath: oc.meta(openapi({
      path: '/static',
      prefix: '/prefix',
    })),

    dynamicPrefix: oc.meta(openapi({
      path: '/static',
      prefix: '/dynamic-prefix/{prefix}',
    })).input(z.object({ prefix: z.string() })),

    styledParams: oc.meta(openapi({
      path: '/{params}',
      paramsStyles: {
        params: 'comma-delimited-array',
      },
    })).input(z.object({ params: z.array(z.string()) })),

    mixed201Path: oc.meta(openapi({
      path: '/{param}/{+rest}',
      prefix: '/mixed/{prefixes}',
      successStatus: 201,
      paramsStyles: {
        prefixes: 'comma-delimited-array',
      },
    })).input(z.object({ prefixes: z.array(z.string()), param: z.string(), rest: z.string() })),
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
      return implement(contract.prefixedPath).handler(({ input }) => `prefixed path`)
    }

    @Implement(contract.dynamicPrefix)
    dynamicPrefix() {
      return implement(contract.dynamicPrefix).handler(({ input }) => `prefix: ${input.prefix}`)
    }

    @Implement(contract.styledParams)
    styledParams() {
      return implement(contract.styledParams).handler(({ input }) => `params: ${input.params}`)
    }

    @Implement(contract.mixed201Path)
    mixed201Path() {
      return implement(contract.mixed201Path).handler(({ input }) => `prefixes: ${input.prefixes} param: ${input.param}, rest: ${input.rest}`)
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
        prefixedPath: implement(contract.prefixedPath).handler(({ input }) => `prefixed path`),
        dynamicPrefix: implement(contract.dynamicPrefix).handler(({ input }) => `prefix: ${input.prefix}`),
        styledParams: implement(contract.styledParams).handler(({ input }) => `params: ${input.params}`),
        mixed201Path: implement(contract.mixed201Path).handler(({ input }) => `prefixes: ${input.prefixes} param: ${input.param}, rest: ${input.rest}`),
      }
    }
  }

  describe.each([
    ['procedure-based implementation controller', ProcedureController],
    ['router-based implementation controller', RouterController],
  ] as const)('with %s', (_, Controller) => {
    describe.each([
      ['express adapter', undefined],
      ['fastify adapter', new FastifyAdapter()],
    ] as const)('with %s', async (_, adapter) => {
      const moduleRef = await Test.createTestingModule({
        controllers: [Controller],
      }).compile()

      const app = moduleRef.createNestApplication(adapter as any)
      await app.init()

      if (adapter) {
        await app.getHttpAdapter().getInstance().ready()
      }

      const httpServer = app.getHttpServer()

      it('should handle static path', async () => {
        const res = await supertest(httpServer).get('/static/path')

        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual('static')
      })

      it('should handle dynamic path', async () => {
        const res = await supertest(httpServer).get('/dynamic/value')

        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual('param: value')
      })

      it('should handle rest path', async () => {
        const res = await supertest(httpServer).get('/rest/some/long/path')

        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual('rest: some/long/path')
      })

      it('should handle prefixed path', async () => {
        const res = await supertest(httpServer).post('/prefix/static')

        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual('prefixed path')
      })

      it('should handle dynamic prefix path', async () => {
        const res = await supertest(httpServer).post('/dynamic-prefix/value/static')

        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual('prefix: value')
      })

      it('should handle styled params path', async () => {
        const res = await supertest(httpServer).post('/a,b,c')

        expect(res.statusCode).toEqual(200)
        expect(res.body).toEqual('params: a,b,c')
      })

      it('should handle mixed 201 path', async () => {
        const res = await supertest(httpServer).post('/mixed/a,b/value/some/long/path')

        expect(res.statusCode).toEqual(201)
        expect(res.body).toEqual('prefixes: a,b param: value, rest: some/long/path')
      })

      it('should decode percent-encoded characters in path parameters', async () => {
        const res = await supertest(httpServer).post('/mixed/a%2F,b/value%2F/some/long%2Fpath')

        expect(res.statusCode).toEqual(201)
        expect(res.body).toEqual('prefixes: a/,b param: value/, rest: some/long/path')
      })

      it('should return 404 for unknown path', async () => {
        const res = await supertest(httpServer).get('/unknown/path')

        expect(res.statusCode).toEqual(404)
      })
    })
  })
})

describe('response status, headers and body should follow standardserver', () => {
  const contract = oc.meta(openapi({ outputStructure: 'detailed', path: '/response' }))

  const handler = vi.fn(() => ({}))

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
      imports: [
        ORPCModule.forRoot({ routingInterceptors: [routingInterceptor] }),
      ],
    }).compile()

    const returnedValueSPy = vi.fn()
    const app = moduleRef.createNestApplication(adapter as any)
    app.useGlobalInterceptors(new class implements NestInterceptor {
      intercept(ctx: ExecutionContext, next: CallHandler) {
        return next.handle().pipe(
          tap(value => returnedValueSPy(value)),
        )
      }
    }())
    await app.init()

    if (adapter) {
      await app.getHttpAdapter().getInstance().ready()
    }

    const httpServer = app.getHttpServer()

    it('should response with output status', async () => {
      handler
        .mockResolvedValueOnce({ status: 202 })
        .mockResolvedValueOnce({ status: 203 })

      await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
        expect(res.statusCode).toEqual(202)
        return true
      })

      await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
        expect(res.statusCode).toEqual(203)
        return true
      })
    })

    it('should response with output headers', async () => {
      handler.mockResolvedValueOnce({ headers: {
        'x-custom': 'value',
        'set-cookie': ['cookie1=value1', 'cookie2=value2'],
        'x-undefined': undefined,
      } })

      await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
        expect(res.statusCode).toEqual(200)
        expect(res.headers['x-custom']).toEqual('value')
        expect(res.headers['set-cookie']).toEqual(['cookie1=value1', 'cookie2=value2'])
        expect(res.headers['x-undefined']).toBeUndefined()

        return true
      })
    })

    describe('response body', () => {
      it('should handle undefined body as empty', async () => {
        handler.mockResolvedValueOnce({})

        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toBeUndefined()
          expect(res.headers['content-length']).toEqual('0')
          expect(res.headers['content-type']).toBeUndefined()
          expect(res.text).toEqual('')

          expect(returnedValueSPy).toHaveBeenCalledWith(undefined)

          return true
        })
      })

      it('should handle primitive, array and object as JSON and do not stringify if possible', async () => {
        handler.mockResolvedValueOnce({ body: 'string' })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toBeUndefined()
          expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
          expect(res.text).toEqual('"string"')

          return true
        })

        handler.mockResolvedValueOnce({ body: null })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toBeUndefined()
          expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
          expect(res.text).toEqual('null')

          return true
        })

        handler.mockResolvedValueOnce({ body: true })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toBeUndefined()
          expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
          expect(res.text).toEqual('true')

          // do not stringify if possible
          expect(returnedValueSPy).toHaveBeenCalledWith(true)

          return true
        })

        handler.mockResolvedValueOnce({ body: 123 })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toBeUndefined()
          expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
          expect(res.text).toEqual('123')

          // do not stringify if possible
          expect(returnedValueSPy).toHaveBeenCalledWith(123)

          return true
        })

        handler.mockResolvedValueOnce({ body: [1, 2, 3] })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toBeUndefined()
          expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
          expect(res.text).toEqual('[1,2,3]')

          // do not stringify if possible
          expect(returnedValueSPy).toHaveBeenCalledWith([1, 2, 3])

          return true
        })

        handler.mockResolvedValueOnce({ body: { a: 1, b: 2 } })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toBeUndefined()
          expect(res.headers['content-type']).toEqual('application/json; charset=utf-8')
          expect(res.text).toEqual('{"a":1,"b":2}')

          // do not stringify if possible
          expect(returnedValueSPy).toHaveBeenCalledWith({ a: 1, b: 2 })

          return true
        })
      })

      it('should handle Blob and File as StreamableFile and can override auto-generated content-disposition', async () => {
        const blob = new Blob(['blob content'], { type: 'application/pdf' })
        const file = new File(['file content'], 'test.pdf', { type: 'application/pdf' })

        handler.mockResolvedValueOnce({ body: blob })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toEqual('file')
          expect(res.headers['content-type']).toEqual('application/pdf')
          expect(res.header['content-length']).toEqual(blob.size.toString())
          expect(res.headers['content-disposition']).toContain('blob') // auto-gen
          expect(res.body).toEqual(Buffer.from('blob content'))

          expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))

          return true
        })

        handler.mockResolvedValueOnce({ body: file })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toEqual('file')
          expect(res.headers['content-type']).toEqual('application/pdf')
          expect(res.header['content-length']).toEqual(file.size.toString())
          expect(res.headers['content-disposition']).toContain('test.pdf') // auto-gen
          expect(res.body).toEqual(Buffer.from('file content'))

          expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))

          return true
        })

        handler.mockResolvedValueOnce({
          body: file,
          headers: { 'content-disposition': 'attachment; filename="custom.pdf"' },
        })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toEqual('file')
          expect(res.headers['content-type']).toEqual('application/pdf')
          expect(res.header['content-length']).toEqual(file.size.toString())
          expect(res.headers['content-disposition']).toBe('attachment; filename="custom.pdf"') // overridden
          expect(res.body).toEqual(Buffer.from('file content'))

          expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))

          return true
        })

        const blobWithoutSize = new Proxy(blob, {
          get(target, p) {
            if (p === 'size') {
              return Number.NaN
            }

            return getOrBind(target, p)
          },
        })
        handler.mockResolvedValueOnce({ body: blobWithoutSize })
        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toEqual('file')
          expect(res.headers['content-type']).toEqual('application/pdf')
          expect(res.header['content-length']).toBeUndefined()
          expect(res.headers['content-disposition']).toContain('blob') // aut-gen
          expect(res.body).toEqual(Buffer.from('blob content'))

          expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))

          return true
        })
      })

      it('should handle URLSearchParams as text application/x-www-form-urlencoded', async () => {
        routingInterceptor.mockResolvedValueOnce({
          matched: true,
          response: { status: 200, headers: {}, body: new URLSearchParams('a=4') },
        })

        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toBeUndefined()
          expect(res.headers['content-type']).toContain('application/x-www-form-urlencoded')
          expect(res.text).toEqual('a=4')

          expect(returnedValueSPy).toHaveBeenCalledWith('a=4')

          return true
        })
      })

      it('should handle FormData as StreamableFile multipart/form-data', async () => {
        handler.mockResolvedValueOnce({ body: { number: 1, blob: new Blob(['blob']) } })

        const res = await supertest(httpServer)
          .post('/response')
          .buffer(true)
          .parse((res, callback) => {
            const chunks: Buffer[] = []

            res.on('data', (chunk) => {
              chunks.push(Buffer.from(chunk))
            })

            res.on('end', () => {
              callback(null, Buffer.concat(chunks))
            })

            res.on('error', (err) => {
              callback(err, undefined)
            })
          })

        expect(res.statusCode).toEqual(200)
        expect(res.headers['standard-server']).toBeUndefined()
        expect(res.headers['content-type']).toMatch(/^multipart\/form-data; /)
        expect(res.body).toSatisfy(Buffer.isBuffer)

        const _res = new Response(res.body, { headers: { 'Content-Type': res.headers['content-type'] } })
        const form = await _res.formData()

        expect(form.get('number')).toEqual('1')
        expect(await (form.get('blob') as Blob).text()).toEqual('blob')

        expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))
      })

      it('should stream ReadableStream and can override content-type', async () => {
        handler.mockResolvedValueOnce({ body: new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('chunk1'))
            controller.enqueue(new TextEncoder().encode(' chunk2'))
            controller.enqueue(new TextEncoder().encode(' chunk3'))
            controller.close()
          },
        }) })

        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toEqual('octet-stream')
          expect(res.headers['content-type']).toEqual('application/octet-stream')
          expect(res.header['content-length']).toBeUndefined()
          expect(res.body).toEqual(Buffer.from('chunk1 chunk2 chunk3'))

          expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))

          return true
        })

        handler.mockResolvedValueOnce({
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('chunk1'))
              controller.enqueue(new TextEncoder().encode(' chunk2'))
              controller.enqueue(new TextEncoder().encode(' chunk3'))
              controller.close()
            },
          }),
          headers: {
            'content-type': 'application/pdf',
          },
        })

        await expect(supertest(httpServer).post('/response')).resolves.toSatisfy((res) => {
          expect(res.statusCode).toEqual(200)
          expect(res.headers['standard-server']).toEqual('octet-stream')
          expect(res.headers['content-type']).toEqual('application/pdf') // overrided
          expect(res.header['content-length']).toBeUndefined()
          expect(res.body).toEqual(Buffer.from('chunk1 chunk2 chunk3'))

          expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))

          return true
        })
      })

      it('should stream event stream', async () => {
        handler.mockResolvedValueOnce({ body: (async function* () {
          yield 'chunk1'
          yield 'chunk2'
          yield 'chunk3'
        }()) })

        const res = await supertest(httpServer)
          .post('/response')
          .buffer(true)
          .parse((res, callback) => {
            const chunks: Buffer[] = []

            res.on('data', (chunk) => {
              chunks.push(Buffer.from(chunk))
            })

            res.on('end', () => {
              callback(null, Buffer.concat(chunks))
            })

            res.on('error', (err) => {
              callback(err, undefined)
            })
          })

        expect(res.statusCode).toEqual(200)
        expect(res.headers['standard-server']).toBeUndefined()
        expect(res.headers['content-type']).toEqual('text/event-stream')
        expect(res.header['content-length']).toBeUndefined()

        expect(res.body).toSatisfy(Buffer.isBuffer)
        expect(res.body.toString()).toContain('chunk1')
        expect(res.body.toString()).toContain('chunk2')
        expect(res.body.toString()).toContain('chunk3')

        expect(returnedValueSPy).toHaveBeenCalledWith(expect.any(StreamableFile))
      })
    })
  })
})

describe('error handling', () => {
  const contract = oc.meta(openapi({
    path: '/error',
  }))

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
      imports: [
        ORPCModule.forRoot({
          routingInterceptors: [routingInterceptor],
        }),
      ],
    }).compile()

    const catchErrorSpy = vi.fn((error) => {
      throw error
    })
    const app = moduleRef.createNestApplication(adapter as any)
    app.useGlobalInterceptors(new class implements NestInterceptor {
      intercept(ctx: ExecutionContext, next: CallHandler<any>) {
        return next.handle().pipe(
          catchError(error => catchErrorSpy(error)),
        )
      }
    }())
    await app.init()

    if (adapter) {
      await app.getHttpAdapter().getInstance().ready()
    }

    const httpServer = app.getHttpServer()

    it('should throw HttpException for regular errors', async () => {
      const error = new ORPCError('NOT_FOUND', { data: 'test data' })
      handler.mockRejectedValueOnce(error)

      const res = await supertest(httpServer).post('/error')

      expect(res.statusCode).toEqual(404)
      expect(res.body).toEqual(error.toJSON())

      expect(catchErrorSpy).toHaveBeenCalledTimes(1)
      expect(catchErrorSpy).toHaveBeenCalledWith(new HttpException(error.toJSON(), 404))
    })

    it('should throw INTERNAL_SERVER_ERROR for non-ORPCError', async () => {
      const error = new Error('test error')
      handler.mockRejectedValueOnce(error)

      const res = await supertest(httpServer).post('/error')

      const expectedError = new ORPCError('INTERNAL_SERVER_ERROR')
      expect(res.statusCode).toEqual(500)
      expect(res.body).toEqual(expectedError.toJSON())

      expect(catchErrorSpy).toHaveBeenCalledTimes(1)
      expect(catchErrorSpy).toHaveBeenCalledWith(new HttpException(expectedError.toJSON(), 500))
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

      await expect(supertest(httpServer).post('/error')).resolves.toSatisfy((res) => {
        expect(res.statusCode).toEqual(502)
        expect(res.text).toEqual('test')
        expect(res.headers['content-type']).toEqual('text/plain')

        return true
      })

      await expect(supertest(httpServer).post('/error')).resolves.toSatisfy((res) => {
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
    const contract = oc.meta(openapi({
      path: '/injection',
    }))

    let req: ExpressRequest

    @Controller()
    class ImplController {
      @Implement(contract)
      injection(@Req() request: any) {
        return implement(contract).handler(() => {
          req = request
        })
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer()).post('/injection')
    expect(res.status).toBe(200)

    expect(req!.method).toBe('POST')
    expect(req!.url).toBe('/injection')
  })

  it('router-based implementation controller can access injected dependencies', async () => {
    const contract = oc.meta(openapi({
      path: '/injection',
    }))

    let req: ExpressRequest

    @Controller()
    class ImplController {
      @Implement({ contract })
      injection(@Req() request: any) {
        return {
          contract: implement(contract).handler(() => {
            req = request
          }),
        }
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer()).post('/injection')
    expect(res.status).toBe(200)

    expect(req!.method).toBe('POST')
    expect(req!.url).toBe('/injection')
  })

  it('router-based implementation controller can handle conflict method names and reflect all metadata on new methods', async () => {
    const contract = {
      ping: oc.meta(openapi({ path: '/ping' })),
      pong: oc.meta(openapi({ path: '/pong' })),
    }

    const Meta: MethodDecorator = (target, propertyKey, descriptor) => {
      Reflect.defineMetadata('orpc:meta', 'value', target, propertyKey)
    }

    @Controller()
    class ImplController {
      @Implement(contract)
      // There is a limitation: @Meta must be used after @Implement.
      @Meta
      router() {
        return {
          ping: implement(contract.ping).handler(() => {}),
          pong: implement(contract.pong).handler(() => {}),
        }
      }

      // conflict method names happens
      router_ping() {}
      router_ping_0() {}
      router_ping_1() {}
    }

    const controller = new ImplController()

    expect(Reflect.getMetadata('orpc:meta', controller, 'router_ping_2')).toEqual('value')
    expect(Reflect.getMetadata('orpc:meta', controller, 'router_pong')).toEqual('value')
  })

  it('should support lazy router/procedure in router-based implementation controller', async () => {
    const contract = oc.meta(openapi({
      path: '/lazy',
    }))

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

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer()).post('/lazy')
    expect(res.status).toBe(200)
  })

  it('can custom request parser with toNestStandardLazyRequest option', async () => {
    const contract = oc.meta(openapi({
      path: '/parser/{param}',
      inputStructure: 'detailed',
    }))

    const handler = vi.fn(({ input }) => input)

    @Controller()
    class ImplController {
      @Implement(contract)
      moduleConfig() {
        return implement(contract).handler(handler)
      }
    }

    const toNestStandardLazyRequest = vi.fn(() => ({
      url: '/test',
      method: 'POST',
      headers: {},
      resolveBody: async () => '__OVERRIDED__',
      params: { param: '__PARAM__' },
    } satisfies NestStandardLazyRequest))

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
      imports: [
        ORPCModule.forRoot({
          toNestStandardLazyRequest,
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer()).post('/parser/value')

    expect(res.statusCode).toEqual(200)
    expect(res.body).toMatchObject({
      body: '__OVERRIDED__',
      params: {
        param: '__PARAM__',
      },
    })

    expect(toNestStandardLazyRequest).toHaveBeenCalledTimes(1)
    expect(toNestStandardLazyRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/parser/value' }),
      expect.objectContaining({ end: expect.any(Function) }),
    )
  })

  it('procedure path[] should use meta.path or fall back to empty', async () => {
    const contract = {
      without: oc.meta(openapi({
        path: '/path/without',
      })),
      with: oc.meta(openapi({
        path: '/path/with',
      })).meta(meta.path(['use', 'this', 'path'])),
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
      imports: [
        ORPCModule.forRoot({
          interceptors: [interceptor],
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res1 = await supertest(app.getHttpServer()).post('/path/without')
    expect(res1.status).toEqual(200)
    expect(res1.body).toEqual([])

    const res2 = await supertest(app.getHttpServer()).post('/path/with')
    expect(res2.status).toEqual(200)
    expect(res2.body).toEqual(['use', 'this', 'path'])

    expect(interceptor).toHaveBeenCalledTimes(2)
    expect(interceptor).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: [] }))
    expect(interceptor).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: ['use', 'this', 'path'] }))
  })

  it('should work with Fastify cookie plugin', async () => {
    const contract = oc.meta(openapi({
      path: '/cookie',
      outputStructure: 'detailed',
    })).input(z.object({ cookie: z.string() }))

    @Controller()
    class ImplController {
      @Implement(contract)
      cookie(@Res({ passthrough: true }) reply: FastifyReply) {
        return implement(contract).handler(({ input }) => {
          reply.setCookie('cookie', input.cookie)

          return {
            headers: {
              'x-input-cookie': input.cookie,
            },
          }
        })
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
    }).compile()

    const adapter = new FastifyAdapter()
    adapter.register(FastifyCookie as any)
    const app = moduleRef.createNestApplication(adapter)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    const res = await supertest(app.getHttpServer()).post('/cookie').send({ cookie: 'test' })
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie']).toBeDefined()
    expect(res.headers['set-cookie']![0]).toContain('cookie=test')
    expect(res.headers['x-input-cookie']).toBe('test')

    await app.close()
  })
})

describe('dynamic context factory', () => {
  it('should work with a static context object (regression)', async () => {
    const contract = oc
      .meta(openapi({ path: '/static-ctx' }))
      .output(z.object({ value: z.string() }))

    let capturedContext: any = null

    @Controller()
    class ImplController {
      @Implement(contract)
      handler() {
        return implement(contract).handler(({ context }) => {
          capturedContext = context
          return { value: 'ok' }
        })
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
      imports: [ORPCModule.forRoot({ context: { db: 'my-database' } as any })],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer()).post('/static-ctx')
    expect(res.status).toBe(200)
    expect(capturedContext).toEqual({ db: 'my-database' })

    await app.close()
  })

  it('should support a synchronous context factory function', async () => {
    const contract = oc
      .meta(openapi({ path: '/sync-ctx' }))
      .output(z.object({ method: z.string() }))

    let capturedContext: any = null

    @Controller()
    class ImplController {
      @Implement(contract)
      handler() {
        return implement(contract).handler(({ context }) => {
          capturedContext = context
          return { method: (context as any).method }
        })
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
      imports: [
        ORPCModule.forRoot({
          context: (ctx) => {
            const req = ctx.switchToHttp().getRequest()
            return { method: req.method } as any
          },
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer()).post('/sync-ctx')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ method: 'POST' })
    expect((capturedContext as any).method).toBe('POST')

    await app.close()
  })

  it('should support an async context factory function', async () => {
    const contract = oc
      .meta(openapi({ path: '/async-ctx' }))
      .output(z.object({ userId: z.string() }))

    let capturedContext: any = null

    @Controller()
    class ImplController {
      @Implement(contract)
      handler() {
        return implement(contract).handler(({ context }) => {
          capturedContext = context
          return { userId: (context as any).userId }
        })
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
      imports: [
        ORPCModule.forRoot({
          context: async (_ctx) => {
            await new Promise(resolve => setTimeout(resolve, 5))
            return { userId: 'user-123' } as any
          },
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer()).post('/async-ctx')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ userId: 'user-123' })
    expect(capturedContext).toEqual({ userId: 'user-123' })

    await app.close()
  })

  it('should pass dynamic context to handler', async () => {
    const contract = oc
      .meta(openapi({ path: '/dynamic-ctx-handler' }))
      .input(z.object({ name: z.string() }))
      .output(z.object({ greeting: z.string(), userId: z.string() }))

    @Controller()
    class ImplController {
      @Implement(contract)
      handler() {
        return implement(contract).handler(({ input, context }) => ({
          greeting: `Hello, ${input.name}`,
          userId: (context as any).userId,
        }))
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
      imports: [
        ORPCModule.forRoot({
          context: _ctx => ({ userId: 'dynamic-user-456' } as any),
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer())
      .post('/dynamic-ctx-handler')
      .send({ name: 'Alice' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ greeting: 'Hello, Alice', userId: 'dynamic-user-456' })

    await app.close()
  })

  it('should read x-tenant-id request header and expose it via context factory', async () => {
    // Real-world scenario: multi-tenant app where each request carries an
    // x-tenant-id header. The context factory reads it once so every handler
    // can access `context.tenantId` without touching the HTTP layer directly.
    const contract = oc
      .meta(openapi({ path: '/whoami' }))
      .output(z.object({ tenantId: z.string() }))

    @Controller()
    class WhoAmIController {
      @Implement(contract)
      whoami() {
        return implement(contract).handler(({ context }) => ({
          tenantId: (context as any).tenantId,
        }))
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [WhoAmIController],
      imports: [
        ORPCModule.forRoot({
          context: (ctx) => {
            const req = ctx.switchToHttp().getRequest()
            return { tenantId: req.headers['x-tenant-id'] ?? 'default' } as any
          },
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer())
      .post('/whoami')
      .set('x-tenant-id', 'acme-corp')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ tenantId: 'acme-corp' })

    await app.close()
  })

  it('should support context factory when using forRootAsync', async () => {
    const contract = oc
      .meta(openapi({ path: '/tenant-async' }))
      .output(z.object({ tenantId: z.string() }))

    @Controller()
    class TenantController {
      @Implement(contract)
      tenant() {
        return implement(contract).handler(({ context }) => ({
          tenantId: (context as any).tenantId,
        }))
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantController],
      imports: [
        ORPCModule.forRootAsync({
          useFactory: () => ({
            context: (ctx: any) => {
              const req = ctx.switchToHttp().getRequest()
              return { tenantId: req.headers['x-tenant-id'] ?? 'default' } as any
            },
          }),
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer())
      .post('/tenant-async')
      .set('x-tenant-id', 'acme-corp')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ tenantId: 'acme-corp' })

    await app.close()
  })
})

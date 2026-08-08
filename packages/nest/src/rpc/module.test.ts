import type { ExecutionContext } from '@nestjs/common'
import { Controller } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { meta, oc } from '@orpc/contract'
import { implement } from '@orpc/server'
import supertest from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Implement, ORPCModule } from './index'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rPC module configuration', () => {
  const contract = oc.meta(meta.path(['module-config']))

  const handler = vi.fn(({ context }: { context: { source?: string } }) => context.source)

  @Controller()
  class ImplController {
    @Implement(contract)
    moduleConfig() {
      return implement(contract).handler(handler)
    }
  }

  it('forRoot', async () => {
    const routingInterceptor = vi.fn(({ next }) => next())

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
      imports: [
        ORPCModule.forRoot({
          context: (ctx: ExecutionContext) => ({ source: 'forRoot' }),
          routingInterceptors: [routingInterceptor],
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res = await supertest(app.getHttpServer()).post('/module-config')

    expect(res.statusCode).toEqual(200)
    expect(res.body).toEqual({ json: 'forRoot' })
    expect(routingInterceptor).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('forRootAsync', async () => {
    const routingInterceptor = vi.fn(({ next }) => next())
    const useFactory = vi.fn((req: any) => ({
      context: (ctx: ExecutionContext) => ({ source: 'forRootAsync' }),
      routingInterceptors: [routingInterceptor],
    }))

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
      imports: [
        ORPCModule.forRootAsync({
          useFactory,
          inject: [REQUEST],
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res1 = await supertest(app.getHttpServer()).post('/module-config?test=1')

    expect(useFactory).toHaveBeenCalledTimes(1)
    expect(useFactory).toHaveBeenCalledWith(expect.objectContaining({ url: '/module-config?test=1', method: 'POST' }))
    expect(res1.statusCode).toEqual(200)
    expect(res1.body).toEqual({ json: 'forRootAsync' })
    expect(routingInterceptor).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(1)

    const res2 = await supertest(app.getHttpServer()).post('/module-config?test=2')

    expect(res2.statusCode).toEqual(200)
    expect(res2.body).toEqual({ json: 'forRootAsync' })
    expect(useFactory).toHaveBeenCalledTimes(2)
    expect(useFactory).toHaveBeenCalledWith(expect.objectContaining({ url: '/module-config?test=2', method: 'POST' }))
    expect(routingInterceptor).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('can access NestJS request context', async () => {
    const contract = oc.meta(meta.path(['module-config']))

    @Controller()
    class ImplController {
      @Implement(contract)
      moduleConfig() {
        return implement(contract).handler(({ context }: { context: { url?: string } }) => context.url)
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ImplController],
      imports: [
        ORPCModule.forRoot({
          context: (ctx: ExecutionContext) => ({ url: ctx.switchToHttp().getRequest().url }),
        }),
      ],
    }).compile()

    const app = moduleRef.createNestApplication()
    await app.init()

    const res1 = await supertest(app.getHttpServer()).post('/module-config?request=1')
    expect(res1.statusCode).toEqual(200)
    expect(res1.body).toEqual({ json: '/module-config?request=1' })

    const res2 = await supertest(app.getHttpServer()).post('/module-config?request=2')
    expect(res2.statusCode).toEqual(200)
    expect(res2.body).toEqual({ json: '/module-config?request=2' })
  })
})

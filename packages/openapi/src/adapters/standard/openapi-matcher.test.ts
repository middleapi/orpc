import { oc } from '@orpc/contract'
import { os, withHiddenRouterContract } from '@orpc/server'
import { getOpenAPIMeta, openapi } from '../../meta'
import { OpenAPIMatcher } from './openapi-matcher'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openAPIMatcher', () => {
  describe('direct routes', () => {
    it('matches generated and explicit OpenAPI routes after pathname normalization', async () => {
      const ping = os.handler(() => 'pong')
      const echo = os
        .meta(openapi({ method: 'GET', path: '/nested/echo/{value}' }))
        .handler(() => 'echo')

      const matcher = new OpenAPIMatcher({
        ping,
        nested: { echo },
      })

      await expect(matcher.match('POST', '/ping', undefined)).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('GET', '/nested/%65cho/dinwwwh%2F', undefined)).resolves.toEqual({
        path: ['nested', 'echo'],
        procedure: echo,
        params: { value: 'dinwwwh/' },
      })

      await expect(matcher.match('POST', '/nested/echo/dinwwwh%2F', undefined)).resolves.toBeUndefined()
    })

    it('normalizes trailing slashes in request paths and OpenAPI route definitions', async () => {
      const ping = os.handler(() => 'pong')
      const echo = os
        .meta(openapi({ method: 'GET', path: '/echo/' }))
        .handler(() => 'echo')

      const matcher = new OpenAPIMatcher({ ping, echo })

      await expect(matcher.match('POST', '/ping/', undefined)).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('GET', '/echo', undefined)).resolves.toEqual({
        path: ['echo'],
        procedure: echo,
        params: undefined,
      })

      await expect(matcher.match('GET', '/echo/', undefined)).resolves.toEqual({
        path: ['echo'],
        procedure: echo,
        params: undefined,
      })
    })

    it('decodes catch-all params and trims trailing slashes', async () => {
      const files = os
        .meta(openapi({ method: 'GET', path: '/files/{+path}' }))
        .handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ files })

      await expect(matcher.match('GET', '/files/a/b/c%2Fd/', undefined)).resolves.toEqual({
        path: ['files'],
        procedure: files,
        params: { path: 'a/b/c/d' },
      })
    })

    it('applies OpenAPI prefixes to generated and explicit routes', async () => {
      const ping = os
        .meta(openapi({ prefix: '/api' }))
        .handler(() => 'pong')

      const echo = os
        .meta(openapi({ method: 'GET', prefix: '/api/v1', path: '/echo/{value}' }))
        .handler(() => 'echo')

      const matcher = new OpenAPIMatcher({ ping, echo })

      await expect(matcher.match('POST', '/api/ping', undefined)).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('GET', '/api/v1/echo/world', undefined)).resolves.toEqual({
        path: ['echo'],
        procedure: echo,
        params: { value: 'world' },
      })

      await expect(matcher.match('POST', '/ping', undefined)).resolves.toBeUndefined()
      await expect(matcher.match('GET', '/echo/world', undefined)).resolves.toBeUndefined()
    })

    it('supports filtering procedures during indexing', async () => {
      const ping = os.handler(() => 'pong')
      const secret = os.handler(() => 'hidden')
      const filter = vi.fn((_procedure: unknown, path: string[]) => !path.includes('secret'))

      const matcher = new OpenAPIMatcher({
        ping,
        internal: { secret },
      }, {
        filter,
      })

      await expect(matcher.match('POST', '/ping', undefined)).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('POST', '/internal/secret', undefined)).resolves.toBeUndefined()

      expect(filter.mock.calls).toContainEqual([ping, ['ping']])
      expect(filter.mock.calls).toContainEqual([secret, ['internal', 'secret']])
    })

    it('keeps a param literally named __proto__ as an own property', async () => {
      const procedure = os
        .meta(openapi({ method: 'GET', path: '/a/{__proto__}' }))
        .handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ procedure })
      const result = await matcher.match('GET', '/a/value', undefined)

      expect(result).toBeDefined()
      expect(Object.keys(result!.params!)).toEqual(['__proto__'])
      expect(Object.getOwnPropertyDescriptor(result!.params!, '__proto__')?.value).toBe('value')
    })

    it('supports both normal and catch-all params at the same time', async () => {
      const procedure = os
        .meta(openapi({ method: 'GET', path: '/{name}/{+rest}' }))
        .handler(() => 'ok')

      const matcher = new OpenAPIMatcher({ procedure })

      await expect(matcher.match('GET', '/a/b/c%2Fd/', undefined)).resolves.toEqual({
        path: ['procedure'],
        procedure,
        params: { name: 'a', rest: 'b/c/d' },
      })
    })
  })

  describe('literal path text', () => {
    it('treats ":" in a static segment as literal text, not a param', async () => {
      const batchGet = os.meta(openapi({ path: '/users:batchGet' })).handler(() => 'get')
      const batchDelete = os.meta(openapi({ path: '/users:batchDelete' })).handler(() => 'delete')
      const bulk = os.meta(openapi({ path: '/items:bulk' })).handler(() => 'bulk')

      const matcher = new OpenAPIMatcher({ batchGet, batchDelete, bulk })

      await expect(matcher.match('POST', '/users:batchGet', undefined)).resolves.toEqual({
        path: ['batchGet'],
        procedure: batchGet,
        params: undefined,
      })

      await expect(matcher.match('POST', '/users:batchDelete', undefined)).resolves.toEqual({
        path: ['batchDelete'],
        procedure: batchDelete,
        params: undefined,
      })

      await expect(matcher.match('POST', '/users%3AbatchDelete', undefined)).resolves.toEqual({
        path: ['batchDelete'],
        procedure: batchDelete,
        params: undefined,
      })

      await expect(matcher.match('POST', '/items:bulk', undefined)).resolves.toEqual({
        path: ['bulk'],
        procedure: bulk,
        params: undefined,
      })

      await expect(matcher.match('POST', '/users:other', undefined)).resolves.toBeUndefined()
      await expect(matcher.match('POST', '/items', undefined)).resolves.toBeUndefined()
    })

    it('prefers a static segment containing ":" over a param sibling', async () => {
      const batchGet = os.meta(openapi({ path: '/users:batchGet' })).handler(() => 'get')
      const byName = os.meta(openapi({ path: '/{name}' })).handler(() => 'name')

      const matcher = new OpenAPIMatcher({ byName, batchGet })

      await expect(matcher.match('POST', '/users:batchGet', undefined)).resolves.toEqual({
        path: ['batchGet'],
        procedure: batchGet,
        params: undefined,
      })

      await expect(matcher.match('POST', '/users:other', undefined)).resolves.toEqual({
        path: ['byName'],
        procedure: byName,
        params: { name: 'users:other' },
      })
    })

    it('treats braces that are not a valid param as literal text', async () => {
      const dotted = os.meta(openapi({ method: 'GET', path: '/users/{user.id}' })).handler(() => 'dotted')
      const embedded = os.meta(openapi({ method: 'GET', path: '/orgs/{name}fix/{id}' })).handler(() => 'embedded')

      const matcher = new OpenAPIMatcher({ dotted, embedded })

      await expect(matcher.match('GET', '/users/%7Buser.id%7D', undefined)).resolves.toEqual({
        path: ['dotted'],
        procedure: dotted,
        params: undefined,
      })

      await expect(matcher.match('GET', '/users/{user.id}', undefined)).resolves.toEqual({
        path: ['dotted'],
        procedure: dotted,
        params: undefined,
      })

      await expect(matcher.match('GET', '/users/user.id', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/orgs/%7Bname%7Dfix/1', undefined)).resolves.toEqual({
        path: ['embedded'],
        procedure: embedded,
        params: { id: '1' },
      })

      await expect(matcher.match('GET', '/orgs/acmefix/1', undefined)).resolves.toBeUndefined()
    })

    it('treats "*", "(" and ")" as literal text', async () => {
      const star = os.meta(openapi({ method: 'GET', path: '/files/*' })).handler(() => 'star')
      const doubleStar = os.meta(openapi({ method: 'GET', path: '/all/**' })).handler(() => 'double-star')
      const group = os.meta(openapi({ method: 'GET', path: '/v(1)/{id}' })).handler(() => 'group')
      const generated = os.handler(() => 'generated')

      const matcher = new OpenAPIMatcher({ star, doubleStar, group, 'gen(*)': generated })

      await expect(matcher.match('GET', '/files/*', undefined)).resolves.toEqual({
        path: ['star'],
        procedure: star,
        params: undefined,
      })
      await expect(matcher.match('GET', '/files/%2A', undefined)).resolves.toMatchObject({ path: ['star'] })
      await expect(matcher.match('GET', '/files/readme', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/all/**', undefined)).resolves.toMatchObject({ path: ['doubleStar'] })
      await expect(matcher.match('GET', '/all/a/b', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('GET', '/v(1)/a*b', undefined)).resolves.toEqual({
        path: ['group'],
        procedure: group,
        params: { id: 'a*b' },
      })
      await expect(matcher.match('GET', '/v1/a', undefined)).resolves.toBeUndefined()

      await expect(matcher.match('POST', '/gen(*)', undefined)).resolves.toMatchObject({ path: ['gen(*)'] })
      await expect(matcher.match('POST', '/gen%28%2A%29', undefined)).resolves.toMatchObject({ path: ['gen(*)'] })
      await expect(matcher.match('POST', '/gen', undefined)).resolves.toBeUndefined()
    })
  })

  describe('explicit path encoding', () => {
    it('matches explicit paths with non-ASCII characters and spaces', async () => {
      const cafe = os.meta(openapi({ method: 'GET', path: '/café/{id}' })).handler(() => 'cafe')
      const spaced = os.meta(openapi({ method: 'GET', path: '/my files/{name}' })).handler(() => 'spaced')

      const matcher = new OpenAPIMatcher({ cafe, spaced })

      await expect(matcher.match('GET', '/caf%C3%A9/1', undefined)).resolves.toEqual({
        path: ['cafe'],
        procedure: cafe,
        params: { id: '1' },
      })

      await expect(matcher.match('GET', '/caf%c3%a9/1', undefined)).resolves.toMatchObject({ path: ['cafe'] })
      await expect(matcher.match('GET', '/café/1', undefined)).resolves.toMatchObject({ path: ['cafe'] })

      await expect(matcher.match('GET', '/my%20files/r%C3%A9sum%C3%A9.pdf', undefined)).resolves.toEqual({
        path: ['spaced'],
        procedure: spaced,
        params: { name: 'résumé.pdf' },
      })
    })

    it('treats percent-encoded explicit paths the same as their decoded form', async () => {
      const encoded = os.meta(openapi({ method: 'GET', path: '/caf%C3%A9' })).handler(() => 'encoded')
      const percent = os.meta(openapi({ method: 'GET', path: '/100%' })).handler(() => 'percent')

      const matcher = new OpenAPIMatcher({ encoded, percent })

      await expect(matcher.match('GET', '/caf%C3%A9', undefined)).resolves.toMatchObject({ path: ['encoded'] })
      await expect(matcher.match('GET', '/100%25', undefined)).resolves.toMatchObject({ path: ['percent'] })
      await expect(matcher.match('GET', '/100%', undefined)).resolves.toMatchObject({ path: ['percent'] })
    })

    it('matches prefixes with non-ASCII characters, including lazy router prefixes', async () => {
      const info = os.meta(openapi({ method: 'GET', path: '/info' })).handler(() => 'info')
      const loader = vi.fn(async () => ({ default: { info } }))

      const matcher = new OpenAPIMatcher({
        direct: os.meta(openapi({ method: 'GET', prefix: '/café', path: '/menu' })).handler(() => 'menu'),
        lazy: os.meta(openapi({ prefix: '/ünïcode' })).lazy(loader),
      })

      await expect(matcher.match('GET', '/caf%C3%A9/menu', undefined)).resolves.toMatchObject({ path: ['direct'] })

      await expect(matcher.match('GET', '/%C3%BCn%C3%AFcode/info', undefined)).resolves.toMatchObject({
        path: ['lazy', 'info'],
        params: undefined,
      })

      expect(loader).toHaveBeenCalledTimes(1)
    })
  })

  describe('slash-allowing params', () => {
    it('throws when a slash-allowing param is not the last segment', () => {
      const meta = os.meta(openapi({ method: 'GET', path: '/files/{+path}/meta' })).handler(() => 'meta')

      expect(() => new OpenAPIMatcher({ files: { meta } })).toThrowError(
        '[OpenAPIMatcher] Invalid OpenAPI path for procedure at path: "files.meta". '
        + 'The "{+path}" param must be the last segment of path "/files/{+path}/meta", because it matches the rest of the path.',
      )

      const prefixed = os.meta(openapi({ method: 'GET', prefix: '/files/{+path}', path: '/content' })).handler(() => 'content')

      expect(() => new OpenAPIMatcher({ prefixed })).toThrowError(
        'The "{+path}" param must be the last segment of path "/files/{+path}/content"',
      )
    })

    it('throws when a lazy router contains a slash-allowing param that is not the last segment', async () => {
      const meta = os.meta(openapi({ method: 'GET', path: '/files/{+path}/meta' })).handler(() => 'meta')

      const matcher = new OpenAPIMatcher({ lazy: os.lazy(async () => ({ default: { meta } })) })

      await expect(matcher.match('GET', '/files/a/meta', undefined)).rejects.toThrowError(
        '[OpenAPIMatcher] Invalid OpenAPI path for procedure at path: "lazy.meta".',
      )
    })

    it('allows a trailing slash after a slash-allowing param', async () => {
      const files = os.meta(openapi({ method: 'GET', path: '/files/{+path}/' })).handler(() => 'files')

      const matcher = new OpenAPIMatcher({ files })

      await expect(matcher.match('GET', '/files/a/b', undefined)).resolves.toEqual({
        path: ['files'],
        procedure: files,
        params: { path: 'a/b' },
      })
    })
  })

  describe('runtime prefix stripping', () => {
    it('strips prefixes before route matching, including trailing slash prefixes', async () => {
      const ping = os.handler(() => 'pong')
      const pong = os.meta(openapi({ path: '/' })).handler(() => 'pong')
      const matcher = new OpenAPIMatcher({ ping, pong })

      await expect(matcher.match('POST', '/api/v1/ping', '/api/v1')).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('POST', '/api/ping', '/api/')).resolves.toEqual({
        path: ['ping'],
        procedure: ping,
        params: undefined,
      })

      await expect(matcher.match('POST', '/api', '/api')).resolves.toEqual({
        path: ['pong'],
        procedure: pong,
        params: undefined,
      })
    })

    it('mismatch when the runtime prefix is missing or not a full path segment', async () => {
      const ping = os.handler(() => 'pong')
      const matcher = new OpenAPIMatcher({ ping })

      await expect(matcher.match('POST', '/other/ping', '/api')).resolves.toBeUndefined()
      await expect(matcher.match('POST', '/apiping', '/api')).resolves.toBeUndefined()
    })
  })

  describe('lazy routers', () => {
    it('resolves unprefixed lazy routers once and reuses indexed routes', async () => {
      const info = os
        .meta(openapi({ method: 'GET', path: '/info' }))
        .handler(() => 'info')

      const loader = vi.fn(async () => ({
        default: { info },
      }))

      const matcher = new OpenAPIMatcher({
        lazy: os.lazy(loader),
      })

      await expect(matcher.match('GET', '/info', undefined)).resolves.toEqual({
        path: ['lazy', 'info'],
        procedure: info,
        params: undefined,
      })

      await expect(matcher.match('GET', '/info', undefined)).resolves.toEqual({
        path: ['lazy', 'info'],
        procedure: info,
        params: undefined,
      })

      expect(loader).toHaveBeenCalledTimes(1)
    })

    it('resolves prefixed lazy routers only when the pathname matches the prefix pattern', async () => {
      const info = os
        .meta(openapi({ method: 'GET', path: '/info/{tab}' }))
        .handler(() => 'info')

      const loader = vi.fn(async () => ({
        default: { info },
      }))

      const matcher = new OpenAPIMatcher({
        user: os.meta(openapi({ prefix: '/users/{userId}' })).lazy(loader),
      })

      await expect(matcher.match('GET', '/projects/42/info/general', undefined)).resolves.toBeUndefined()
      expect(loader).toHaveBeenCalledTimes(0)

      const firstResult = await matcher.match('GET', '/users/din/info/settings', undefined)

      expect(firstResult).toBeDefined()
      expect(firstResult!.path).toEqual(['user', 'info'])
      expect(firstResult!.params).toEqual({ userId: 'din', tab: 'settings' })
      expect(getOpenAPIMeta(firstResult!.procedure)).toMatchObject({
        method: 'GET',
        path: '/info/{tab}',
        prefix: '/users/{userId}',
      })

      await expect(matcher.match('GET', '/users/din/info/settings', undefined)).resolves.toEqual(firstResult)

      expect(loader).toHaveBeenCalledTimes(1)
    })

    it('retries a lazy router whose load fails, synchronously or asynchronously', async () => {
      const info = os
        .meta(openapi({ method: 'GET', path: '/info' }))
        .handler(() => 'info')

      let attempts = 0
      const loader = vi.fn(() => {
        attempts++
        // the first attempt throws synchronously out of `unlazy`, the second rejects
        if (attempts === 1) {
          throw new Error('sync boom')
        }
        if (attempts === 2) {
          return Promise.reject(new Error('async boom'))
        }
        return Promise.resolve({ default: { info } })
      })

      const matcher = new OpenAPIMatcher({ lazy: os.lazy(loader as any) })

      await expect(matcher.match('GET', '/info', undefined)).rejects.toThrowError('sync boom')
      await expect(matcher.match('GET', '/info', undefined)).rejects.toThrowError('async boom')

      // a failed load must leave the router pending so a later match can still resolve it
      await expect(matcher.match('GET', '/info', undefined)).resolves.toEqual({
        path: ['lazy', 'info'],
        procedure: info,
        params: undefined,
      })

      expect(loader).toHaveBeenCalledTimes(3)
    })

    it('resolves a prefixed lazy router that only matches after percent-decoding', async () => {
      const info = os
        .meta(openapi({ method: 'GET', path: '/info' }))
        .handler(() => 'info')

      const loader = vi.fn(async () => ({ default: { info } }))

      const matcher = new OpenAPIMatcher({
        user: os.meta(openapi({ prefix: '/users' })).lazy(loader),
      })

      // "%75" is "u": the prefix RegExp only matches once the pathname is canonicalized
      const result = await matcher.match('GET', '/%75sers/info', undefined)

      expect(result).toBeDefined()
      expect(result!.path).toEqual(['user', 'info'])
      expect(result!.params).toBeUndefined()
      expect(getOpenAPIMeta(result!.procedure)).toMatchObject({
        method: 'GET',
        path: '/info',
        prefix: '/users',
      })

      expect(loader).toHaveBeenCalledTimes(1)
    })

    it('resolves nested lazy routers added during the same match', async () => {
      const summary = os
        .meta(openapi({ method: 'GET', path: '/summary' }))
        .handler(() => 'summary')

      const projectLoader = vi.fn(async () => ({
        default: { summary },
      }))

      const outerLoader = vi.fn(async () => ({
        default: {
          project: os.meta(openapi({ prefix: '/projects/{projectId}' })).lazy(projectLoader),
        },
      }))

      const matcher = new OpenAPIMatcher({
        lazy: os.lazy(outerLoader),
      })

      const firstResult = await matcher.match('GET', '/projects/42/summary', undefined)

      expect(firstResult).toBeDefined()
      expect(firstResult!.path).toEqual(['lazy', 'project', 'summary'])
      expect(firstResult!.params).toEqual({ projectId: '42' })
      expect(getOpenAPIMeta(firstResult!.procedure)).toMatchObject({
        method: 'GET',
        path: '/summary',
        prefix: '/projects/{projectId}',
      })

      await expect(matcher.match('GET', '/projects/42/summary', undefined)).resolves.toEqual(firstResult)

      expect(outerLoader).toHaveBeenCalledTimes(1)
      expect(projectLoader).toHaveBeenCalledTimes(1)
    })

    it('resolves a deep lazy chain for concurrent matches without losing or reloading routers', async () => {
      const leaf1 = os.meta(openapi({ method: 'GET', path: '/leaf1' })).handler(() => '1')
      const leaf2 = os.meta(openapi({ method: 'GET', path: '/leaf2' })).handler(() => '2')
      const leaf3 = os.meta(openapi({ method: 'GET', path: '/leaf3' })).handler(() => '3')

      const loads = { l1: 0, l2: 0, l3: 0 }

      /** settle after N microtask turns so the three levels interleave */
      const settle = async (turns: number) => {
        for (let i = 0; i < turns; i++) {
          await Promise.resolve()
        }
      }

      const l3 = os.meta(openapi({ prefix: '/p3' })).lazy(async () => {
        loads.l3++
        await settle(2)
        return { default: { leaf3 } }
      })

      const l2 = os.meta(openapi({ prefix: '/p2' })).lazy(async () => {
        loads.l2++
        await settle(3)
        return { default: { leaf2, l3 } }
      })

      const matcher = new OpenAPIMatcher({
        lazy: os.lazy(async () => {
          loads.l1++
          await settle(4)
          return { default: { leaf1, l2 } }
        }),
      })

      const paths = ['/leaf1', '/p2/leaf2', '/p2/p3/leaf3'] as const
      const results = await Promise.all(
        paths.flatMap(path => [
          matcher.match('GET', path, undefined),
          matcher.match('GET', path, undefined),
        ]),
      )

      expect(results.map(result => result?.path.join('/'))).toEqual([
        'lazy/leaf1',
        'lazy/leaf1',
        'lazy/l2/leaf2',
        'lazy/l2/leaf2',
        'lazy/l2/l3/leaf3',
        'lazy/l2/l3/leaf3',
      ])

      // every level is loaded exactly once even though six matches raced for it
      expect(loads).toEqual({ l1: 1, l2: 1, l3: 1 })

      // and the deepest route stays matchable afterwards
      await expect(matcher.match('GET', '/p2/p3/leaf3', undefined)).resolves.toBeDefined()
      expect(loads).toEqual({ l1: 1, l2: 1, l3: 1 })
    })
  })

  describe('contract-first routers', () => {
    it('wraps implementations with contract metadata and caches wrapped procedures', async () => {
      const implementation = {
        ping: os
          .meta(openapi({ method: 'GET', path: '/implementation' }))
          .handler(() => 'pong'),
      }

      const contract = {
        ping: oc.meta(openapi({ method: 'DELETE', path: '/contract/{id}' })),
      }

      const matcher = new OpenAPIMatcher(withHiddenRouterContract(implementation, contract))
      const firstResult = await matcher.match('DELETE', '/contract/42', undefined)

      expect(firstResult).toBeDefined()
      expect(firstResult!.path).toEqual(['ping'])
      expect(firstResult!.params).toEqual({ id: '42' })
      expect(firstResult!.procedure).not.toBe(implementation.ping)
      expect(getOpenAPIMeta(firstResult!.procedure)).toMatchObject({
        method: 'DELETE',
        path: '/contract/{id}',
      })

      const secondResult = await matcher.match('DELETE', '/contract/42', undefined)

      expect(secondResult).toEqual(firstResult)
      expect(secondResult!.procedure).toBe(firstResult!.procedure) // ensure cache

      await expect(matcher.match('GET', '/implementation', undefined)).resolves.toBeUndefined()
    })

    it('throws when a contract-first implementation is missing', async () => {
      const matcher = new OpenAPIMatcher(withHiddenRouterContract({
        ping: os.handler(() => 'pong'),
      }, {
        missing: oc.meta(openapi({ method: 'GET', path: '/missing' })),
      }))

      await expect(matcher.match('GET', '/missing', undefined)).rejects.toThrowError(
        '[Contract-First] Missing or invalid implementation for procedure at path: "missing"',
      )
    })
  })
})

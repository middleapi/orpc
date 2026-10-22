import { ORPCError } from '@orpc/server'
import * as ServerModule from '@orpc/server'
import * as next from 'next/navigation'
import { createServerFunction } from './server-function'

const createProcedureClientSpy = vi.spyOn(ServerModule, 'createProcedureClient')
const { os, type } = ServerModule

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createServerFunction', () => {
  const procedure = os.input(type<any>()).output(type<any>()).handler(() => 'output')

  it('returns data tuples when the client succeeds', async () => {
    const client = vi.fn().mockResolvedValue({ output: 'pong' })
    createProcedureClientSpy.mockReturnValueOnce(client)

    const args = [procedure, { context: { context: true } }] as const
    const serverFn = createServerFunction(...args)
    expect(createProcedureClientSpy).toHaveBeenCalledTimes(1)
    expect(createProcedureClientSpy).toHaveBeenCalledWith(...args)

    await expect(serverFn({ input: 'ping' })).resolves.toEqual([null, { output: 'pong' }])
    expect(client).toHaveBeenCalledWith({ input: 'ping' })
  })

  it('serializes errors into server action tuples', async () => {
    const error = new ORPCError('BAD_REQUEST', {
      message: 'Invalid input',
      data: { field: 'input' },
    })
    const client = vi.fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(new Error('TEST'))
    createProcedureClientSpy.mockReturnValueOnce(client)

    const args = [procedure, { context: { context: true } }] as const
    const serverFn = createServerFunction(...args)
    expect(createProcedureClientSpy).toHaveBeenCalledTimes(1)
    expect(createProcedureClientSpy).toHaveBeenCalledWith(...args)

    await expect(serverFn({ input: 'ping' })).resolves.toEqual([error.toJSON(), undefined])
    await expect(serverFn({ input: 'ping' })).resolves.toEqual([new ORPCError('INTERNAL_SERVER_ERROR').toJSON(), undefined])
  })

  describe('useActionState shape', () => {
    it('ignores the previous state and passes the second argument as input', async () => {
      const client = vi.fn().mockResolvedValue({ output: 'pong' })
      createProcedureClientSpy.mockReturnValueOnce(client)

      const serverFn = createServerFunction(procedure)

      await expect(serverFn([null, 'previous'], { input: 'ping' })).resolves.toEqual([null, { output: 'pong' }])
      expect(client).toHaveBeenCalledWith({ input: 'ping' })
    })

    it('deserializes bracket notation form data', async () => {
      const client = vi.fn().mockResolvedValue({ output: 'pong' })
      createProcedureClientSpy.mockReturnValueOnce(client)

      const serverFn = createServerFunction(procedure)

      const form = new FormData()
      form.append('user[name]', 'alice')
      form.append('user[tags][]', 'admin')

      await expect(serverFn(null, form)).resolves.toEqual([null, { output: 'pong' }])
      expect(client).toHaveBeenCalledWith({ user: { name: 'alice', tags: ['admin'] } })
    })

    it('passes form data as-is when called with a single argument', async () => {
      const client = vi.fn().mockResolvedValue({ output: 'pong' })
      createProcedureClientSpy.mockReturnValueOnce(client)

      const serverFn = createServerFunction(procedure)

      const form = new FormData()
      form.append('name', 'alice')

      await serverFn(form)
      expect(client).toHaveBeenCalledWith(form)
    })
  })

  it.each([
    [() => next.redirect('/foo')],
    [() => next.forbidden()],
    [() => next.unauthorized()],
    [() => next.notFound()],
  ])('rethrows special Next.js errors %s', async (createError) => {
    (process as any).env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = true

    let error
    try {
      createError()
    }
    catch (e) {
      error = e
    }

    const client = vi.fn().mockRejectedValue(error)
    createProcedureClientSpy.mockReturnValueOnce(client)

    const args = [procedure, { context: { context: true } }] as const
    const serverFn = createServerFunction(...args)
    expect(createProcedureClientSpy).toHaveBeenCalledTimes(1)
    expect(createProcedureClientSpy).toHaveBeenCalledWith(...args)

    await expect(serverFn({ input: 'ping' })).rejects.toBe(error)
  })
})

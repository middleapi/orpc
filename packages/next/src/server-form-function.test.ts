import * as ServerModule from '@orpc/server'
import { createServerFormFunction } from './server-form-function'

const createProcedureClientSpy = vi.spyOn(ServerModule, 'createProcedureClient')
const { os, type } = ServerModule

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createServerFormFunction', () => {
  const procedure = os.input(type<any>()).output(type<any>()).handler(() => 'output')

  it('deserializes bracket notation form data before calling the client', async () => {
    const client = vi.fn().mockResolvedValue(undefined)
    createProcedureClientSpy.mockReturnValueOnce(client)

    const args = [procedure, { context: { context: true } }] as const
    const serverFn = createServerFormFunction(...args)
    expect(createProcedureClientSpy).toHaveBeenCalledTimes(1)
    expect(createProcedureClientSpy).toHaveBeenCalledWith(...args)

    const form = new FormData()
    form.append('user[name]', 'alice')
    form.append('user[role]', 'admin')

    await expect(serverFn(form)).resolves.toBeUndefined()

    expect(client).toHaveBeenCalledWith({
      user: {
        name: 'alice',
        role: 'admin',
      },
    })
  })

  it('rethrow client errors', async () => {
    const error = new Error('TEST')
    const client = vi.fn().mockRejectedValueOnce(error)
    createProcedureClientSpy.mockReturnValueOnce(client)

    const args = [procedure, { context: { context: true } }] as const
    const serverFn = createServerFormFunction(...args)
    expect(createProcedureClientSpy).toHaveBeenCalledTimes(1)
    expect(createProcedureClientSpy).toHaveBeenCalledWith(...args)

    const form = new FormData()
    form.append('user[name]', 'alice')
    form.append('user[role]', 'admin')

    await expect(serverFn(form)).rejects.toBe(error)
  })
})

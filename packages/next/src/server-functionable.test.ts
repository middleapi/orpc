import * as ServerModule from '@orpc/server'
import * as ServerFunctionModule from './server-function.ts'
import { createServerFunctionable } from './server-functionable.ts'

const createServerFunctionSpy = vi.spyOn(ServerFunctionModule, 'createServerFunction')
const { os, type } = ServerModule

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createServerFunctionable', () => {
  const procedure = os.input(type<any>()).output(type<any>()).handler(() => 'output')

  it('returns the wrapped server function and preserves the procedure metadata', () => {
    const client = vi.fn().mockResolvedValue([null, { output: 'pong' }]) as any

    const options = { context: { context: true } }
    createServerFunctionSpy.mockReturnValueOnce(client)

    const functionable = createServerFunctionable(options)(procedure)

    expect(createServerFunctionSpy).toHaveBeenCalledTimes(1)
    expect(createServerFunctionSpy).toHaveBeenCalledWith(procedure, options)
    expect(functionable).toBe(client)
    expect(functionable).toBeInstanceOf(ServerModule.Procedure)
    expect(functionable['~orpc']).toBe(procedure['~orpc'])
  })
})

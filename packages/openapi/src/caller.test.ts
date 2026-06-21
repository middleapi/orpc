import type { ClientContext, ClientLink } from '@orpc/client'
import { createContractCaller } from '@orpc/contract'
import { createContractJsonifiedCaller } from './caller'

vi.mock('@orpc/contract', () => ({
  createContractCaller: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createContractJsonifiedCaller', () => {
  const mockedLink: ClientLink<ClientContext> = {
    call: vi.fn(),
  }

  it('delegates to createContractCaller and returns its result', () => {
    const delegatedCaller = vi.fn()
    const options = { interceptors: [vi.fn()], routerRef: {}, options: {} }

    vi.mocked(createContractCaller).mockReturnValue(delegatedCaller as any)

    const result = createContractJsonifiedCaller(mockedLink, options as any)

    expect(createContractCaller).toHaveBeenCalledTimes(1)
    expect(createContractCaller).toHaveBeenCalledWith(mockedLink, options)
    expect(result).toBe(delegatedCaller)
  })
})

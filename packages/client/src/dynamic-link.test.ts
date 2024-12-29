import type { ProcedureClientOptions } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import { DynamicLink } from './dynamic-link'

describe('dynamicLink', () => {
  it('works', async () => {
    const mockedLink = { call: vi.fn().mockResolvedValue('__mocked__') }
    const mockLinkResolver = vi.fn().mockResolvedValue(mockedLink)
    const link = new DynamicLink(mockLinkResolver)

    const path = ['users', 'getProfile']
    const input = { id: 123 }
    const options: ProcedureClientOptions<any> = {
      context: {
        batch: true,
      },
    }

    expect(await link.call(path, input, options)).toEqual('__mocked__')

    expect(mockLinkResolver).toHaveBeenCalledTimes(1)
    expect(mockLinkResolver).toHaveBeenCalledWith(path, input, options)
    expect(mockedLink.call).toHaveBeenCalledTimes(1)
    expect(mockedLink.call).toHaveBeenCalledWith(path, input, options)
  })
})

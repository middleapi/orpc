import { DynamicLink } from './dynamic-link'
import type { ClientOptions } from './types'

it('dynamicLink', async () => {
  const mockedLink = { call: vi.fn().mockResolvedValue('__mocked__') }
  const mockLinkResolver = vi.fn().mockResolvedValue(mockedLink)
  const link = new DynamicLink(mockLinkResolver)

  const path = ['users', 'getProfile']
  const input = { id: 123 }
  const options: ClientOptions<any> = {
    context: {
      batch: true,
    },
  }

  expect(await link.call(path, input, options)).toEqual('__mocked__')

  expect(mockLinkResolver).toHaveBeenCalledTimes(1)
  expect(mockLinkResolver).toHaveBeenCalledWith(options, path, input)
  expect(mockedLink.call).toHaveBeenCalledTimes(1)
  expect(mockedLink.call).toHaveBeenCalledWith(path, input, options)
})

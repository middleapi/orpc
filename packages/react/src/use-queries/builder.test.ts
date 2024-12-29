import { orpcClient } from '../../tests/orpc'
import { createUseQueriesBuilder } from './builder'

it('createUseQueriesBuilder', async () => {
  const builder = createUseQueriesBuilder({
    client: orpcClient.user.find,
    path: ['user', 'find'],
  })

  const options = builder({ id: '123' })

  expect(options.queryKey).toEqual([
    ['user', 'find'],
    { input: { id: '123' }, type: 'query' },
  ])

  expect(options.queryFn).toBeInstanceOf(Function)

  const result = await (options as any).queryFn({})

  expect(result).toEqual({
    id: '123',
    name: 'name-123',
  })
})

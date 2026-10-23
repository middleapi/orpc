import { os } from '@orpc/server'
import { act, renderHook } from '@testing-library/react'
import { startTransition, useActionState } from 'react'
import { z } from 'zod'
import { createServerFunction } from './server-function'

describe('createServerFunction with useActionState', () => {
  const fn = createServerFunction(
    os
      .input(z.object({ name: z.string().min(3) }))
      .handler(({ input }) => `Hello ${input.name}!`),
  )

  it('works as a useActionState action', async () => {
    const { result } = renderHook(() => useActionState(fn, null))

    const form = new FormData()
    form.append('name', 'Alice')

    await act(async () => {
      startTransition(() => result.current[1](form))
    })

    expect(result.current[0]).toEqual([null, 'Hello Alice!'])

    await act(async () => {
      startTransition(() => result.current[1]({ name: 'Bob' }))
    })

    expect(result.current[0]).toEqual([null, 'Hello Bob!'])
  })
})

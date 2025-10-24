'use client'

import { orpc } from '@/lib/orpc'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export function CreatePlanetMutationForm() {
  const queryClient = useQueryClient()

  const { mutate } = useMutation(
    orpc.planet.create.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({
          queryKey: orpc.planet.key(),
        })
      },
      onError(error) {
        console.error(error)
        alert(error.message)
      },
    }),
  )

  const { mutate: testMutate } = useMutation(orpc.ping.run.mutationOptions())
  const { mutate: testVoidMutate } = useMutation(orpc.ping.runVoid.mutationOptions())

  useCallback(() => {
    testMutate() // this will throw an error if z.void() is not default of input schema
    testMutate(undefined) // this will not throw an error
    testVoidMutate() // this will not throw an error
  }, [testMutate, testVoidMutate])

  return (
    <div>
      <h2>oRPC and Tanstack Query | Create Planet example</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.target as HTMLFormElement)

          const name = form.get('name') as string
          const description
            = (form.get('description') as string | null) ?? undefined
          const image = form.get('image') as File

          mutate({
            name,
            description,
            image: image.size > 0 ? image : undefined,
          })
        }}
      >
        <label>
          Name
          <input type="text" name="name" required />
        </label>
        <label>
          Description
          <textarea name="description" />
        </label>
        <label>
          Image
          <input type="file" name="image" accept="image/*" />
        </label>
        <button type="submit">Submit</button>
      </form>
    </div>
  )
}

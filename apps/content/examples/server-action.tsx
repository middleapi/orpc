'use server'

import { createFormAction } from '@orpc/next'
import { ORPCError, os } from '@orpc/server'
import { oz } from '@orpc/zod'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import * as React from 'react'
import { z } from 'zod'

const authMid = os.middleware(async (input, context, meta) => {
  const headersList = await headers()
  const user = headersList.get('Authorization') ? { id: 'example' } : undefined

  if (!user) {
    throw new ORPCError({ code: 'UNAUTHORIZED' })
  }

  return meta.next({
    context: {
      user,
    },
  })
})

export const updateUser = os
  .use(authMid)
  .input(
    z.object({
      id: z.bigint(),
      user: z.object({
        name: z.string(),
        avatar: oz.file().type('image/*').optional(),
      }),
    }),
  )
  .handler((input, context, meta) => {
    // ^ context.user is automatically injected
    // do something
  })

const updateUserFA = createFormAction({
  procedure: updateUser,
  onSuccess() {
    redirect('/some-where')
  },
})

export default async function Page() {
  const orYouCanCallDirectly = async () => {
    const files = (document.getElementById('files') as HTMLInputElement).files

    updateUser({
      id: 1992n,
      user: {
        name: 'Unnoq',
        avatar: files?.[0],
      },
    })
  }

  // You can use square brackets to express nested data
  return (
    <form action={updateUserFA}>
      {/* Auto convert 1992 to bigint */}
      <input type="number" name="id" value="1992" />
      {/* Auto parse user object */}
      <input type="text" name="user[name]" value="Unnoq" />
      <input
        id="avatar"
        type="file"
        name="user[avatar]"
        accept="image/*"
      />
    </form>
  )
}

//
//

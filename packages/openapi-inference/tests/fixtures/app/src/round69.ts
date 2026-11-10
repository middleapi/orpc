// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os } from '@orpc/server'
import * as z from 'zod'

const procedures: Record<string, any> = {}

procedures.dated = os
  .route({ method: 'POST', path: '/dated' })
  .errors({ LATE: { data: z.object({ due: z.date() }) } })
  .input(z.object({ at: z.date(), id: z.string() }))
  .output(z.object({ at: z.date(), id: z.string() }))
  .handler(({ input }) => input)

procedures.listed = os
  .route({ method: 'GET', path: '/listed' })
  .input(z.object({ from: z.coerce.date().optional() }))
  .output(z.array(z.string()))
  .handler(() => [])

/** A router whose procedures are typed `any`, so their types can not be read */
export const roundSixtyNineAny = procedures

/** A Zod schema whose description a test registers between two generations */
export const registeredNote = z.object({ text: z.string() })

export const roundSixtyNineRegistered = {
  note: os
    .route({ method: 'POST', path: '/note' })
    .input(registeredNote)
    .handler(({ input }) => input.text),
}

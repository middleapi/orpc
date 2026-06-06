import { eventIterator, oc } from '@orpc/contract'
import * as z from 'zod'

export const lunariaStreamContract = {
  events: oc
    .route({
      method: 'GET',
      path: '/apps/lunaria/stream',
      tags: ['Lunaria'],
      summary: 'Lunaria stream events'
    })
    .output(eventIterator(z.object({ time: z.date() })))
}

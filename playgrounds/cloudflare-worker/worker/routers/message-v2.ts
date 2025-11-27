import { pub } from '../orpc'
import * as z from 'zod'

export const onMessageV2 = pub.handler(({ context, lastEventId, signal }) => {
  return context.messagePublisher.subscribe('some-room', { signal, lastEventId })
})

export const sendMessageV2 = pub
  .input(z.object({ message: z.string() }))
  .handler(async ({ context, input }) => {
    await context.messagePublisher.publish('some-room', input)
  })

import { pub } from '@/orpc'
import { PingSchema, PingVoidSchema } from '@/schemas/ping'

export const ping = pub.output(PingSchema).handler(() => 'pong')
export const pingVoid = pub.input(PingVoidSchema).handler(() => 'pong')

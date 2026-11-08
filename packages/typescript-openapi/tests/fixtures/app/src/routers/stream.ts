import { os } from '@orpc/server'

export default {
  ticks: os.handler(async function* () {
    yield { tick: 1 }
    return 'done' as const
  }),
  plain: os.handler(async function* () {
    yield 'x'
  }),
}

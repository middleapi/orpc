import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

it('has no csrfProtection option, since the peer writes every request header itself', () => {
  const router = { ping: os.handler(() => 'pong') }

  const _handler = new RPCHandler(router, {
    // @ts-expect-error csrfProtection only applies to HTTP adapters
    csrfProtection: true,
  })
})

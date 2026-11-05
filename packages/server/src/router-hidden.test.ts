import { oc } from '@orpc/contract'

import { os } from './builder.ts'
import { getHiddenRouterContract, withHiddenRouterContract } from './router-hidden.ts'

const contract = {
  ping: oc.errors({ BAD_GATEWAY: {} }),
}

const router = {
  ping: os.handler(() => 'output'),
}

it('withHiddenRouterContract & getHiddenRouterContract', () => {
  const applied = withHiddenRouterContract(router, contract)

  expect(applied).not.toBe(router)
  expect(applied).toEqual(router)
  expect(getHiddenRouterContract(applied)).toBe(contract)
  expect(getHiddenRouterContract(withHiddenRouterContract(router.ping, contract.ping))).toBe(
    contract.ping,
  )
})

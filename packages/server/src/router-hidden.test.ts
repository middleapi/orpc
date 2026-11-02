import { oc, ProcedureContract } from '@orpc/contract'
import { z } from 'zod'
import { os } from './builder'
import { Procedure } from './procedure'
import { getHiddenRouterContract, withHiddenRouterContract } from './router-hidden'

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
  expect(getHiddenRouterContract(withHiddenRouterContract(router.ping, contract.ping))).toBe(contract.ping)
})

describe('withHiddenRouterContract with a normal router as the contract', () => {
  const real = {
    ping: os.$config({ disableInputValidation: true }).input(z.string()).handler(() => 'REAL'),
    nested: { pong: os.handler(() => 'REAL') },
    contractFirst: { ping: contract.ping },
    invalid: undefined as any,
  }

  it('strips procedures down to plain contracts', () => {
    const hidden = getHiddenRouterContract(withHiddenRouterContract({}, real)) as any

    for (const [procedure, original] of [[hidden.ping, real.ping], [hidden.nested.pong, real.nested.pong]] as const) {
      expect(procedure).toBeInstanceOf(ProcedureContract)
      expect(procedure).not.toBeInstanceOf(Procedure)
      const { handler, orderedMiddlewares, ...contractDef } = original['~orpc']
      expect(procedure['~orpc']).toEqual(contractDef)
    }

    // routers without procedures are kept as is
    expect(hidden.contractFirst).toBe(real.contractFirst)
    expect(hidden.invalid).toBeUndefined()
  })
})

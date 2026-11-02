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
})

it('getHiddenRouterContract returns undefined for non-object values', () => {
  expect(getHiddenRouterContract(undefined)).toBeUndefined()
  expect(getHiddenRouterContract(null as any)).toBeUndefined()
  expect(getHiddenRouterContract('invalid' as any)).toBeUndefined()
  expect(getHiddenRouterContract(router)).toBeUndefined()
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
      expect(procedure['~orpc']).toEqual({
        inputSchemas: original['~orpc'].inputSchemas,
        outputSchemas: original['~orpc'].outputSchemas,
        metaPlugins: original['~orpc'].metaPlugins,
        errorMap: original['~orpc'].errorMap,
        meta: original['~orpc'].meta,
      })
    }

    // routers without procedures are kept as is
    expect(hidden.contractFirst).toBe(real.contractFirst)
    expect(hidden.invalid).toBeUndefined()
  })
})

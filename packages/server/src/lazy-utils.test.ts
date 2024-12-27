import { ContractProcedure } from '@orpc/contract'
import { isLazy, lazy, unlazy } from './lazy'
import { createLazyProcedureFormAnyLazy } from './lazy-utils'
import { Procedure } from './procedure'

describe('createLazyProcedureFormAnyLazy', () => {
  const ping = new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    handler: vi.fn(),
  })

  it('return a Lazy<ANY_PROCEDURE>', async () => {
    const lazyPing = lazy(() => Promise.resolve({ default: ping }))

    const lazyProcedure = createLazyProcedureFormAnyLazy(lazyPing)

    expect(lazyProcedure).toSatisfy(isLazy)
    expect(unlazy(lazyProcedure)).resolves.toEqual({ default: ping })
  })

  it('throw un unlazy non-procedure', () => {
    const lazyPing = lazy(() => Promise.resolve({ default: {} as unknown }))
    const lazyProcedure = createLazyProcedureFormAnyLazy(lazyPing)

    expect(unlazy(lazyProcedure)).rejects.toThrow('Expected a lazy<procedure> but got lazy<unknown>')
  })

  it('flat lazy', () => {
    const lazyPing = lazy(() => Promise.resolve({ default: lazy(() => Promise.resolve({ default: ping })) }))
    const lazyProcedure = createLazyProcedureFormAnyLazy(lazyPing)

    expect(unlazy(lazyProcedure)).resolves.toEqual({ default: ping })
  })
})

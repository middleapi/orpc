import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from 'src/contract'

@Controller()
export class AuthController {
  constructor() {}

  @Implement(contract.auth.signup)
  signup() {
    return implement(contract.auth.signup).handler(({ input }) => {
      return {
        id: '28aa6286-48e9-4f23-adea-3486c86acd55',
        email: input.email,
        name: input.name,
      }
    })
  }

  @Implement(contract.auth.signin)
  signin() {
    return implement(contract.auth.signin).handler(({ input }) => {
      return { token: 'token' }
    })
  }

  @Implement(contract.auth.me)
  me() {
    return implement(contract.auth.me).handler(({ input }) => {
      return {
        id: '1',
        name: 'John Doe',
        email: 'john@doe.com',
      }
    })
  }
}

import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from 'src/contract'

const MAX_EVENTS = 5

@Controller()
export class OtherController {
  constructor() {}

  @Implement(contract.sse)
  list() {
    return implement(contract.sse).handler(async function* () {
      let count = 0

      while (count < MAX_EVENTS) {
        count++
        yield { time: new Date() }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    })
  }
}

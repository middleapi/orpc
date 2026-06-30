import { client as orpc } from './lib/orpc'
import { safe } from '@orpc/client'

const token = await orpc.auth.signin({
  email: 'john@doe.com',
  password: '123456',
})

const [error, planet, isDefined] = await safe(orpc.planet.update({ id: 1, name: 'Earth', description: 'The planet Earth' }))

if (error) {
  if (isDefined) {
    const id = error.data.id
    //    ^    type-safe
  }

  console.log('ERROR', error)
}
else {
  console.log('PLANET', planet)
}

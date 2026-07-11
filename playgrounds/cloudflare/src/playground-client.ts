import { safe } from '@orpc/client'
import { client as orpc } from './lib/orpc'

const planets = await orpc.planet.list({
  cursor: 1,
})

const [error, planet, inferableError] = await safe(orpc.planet.update({
  id: 'some-id',
  name: 'Earth',
  description: 'The planet Earth',
}))

if (error) {
  if (inferableError) {
    const code = error.code
    //    ^    typesafe
  }

  console.log('ERROR', error)
}
else {
  console.log('PLANET', planet)
}

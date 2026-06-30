import { NewPlanet, Planet, UpdatePlanet } from 'src/schemas/planet'
import { User } from 'src/schemas/user'

const planets: Planet[] = [
  {
    id: 1,
    name: 'Earth',
    description: 'The planet Earth',
    imageUrl: 'https://picsum.photos/200/300',
    creator: {
      id: '1',
      name: 'John Doe',
      email: 'john@doe.com',
    },
  },
  {
    id: 2,
    name: 'Mars',
    description: 'The planet Mars',
    imageUrl: 'https://picsum.photos/200/300',
    creator: {
      id: '1',
      name: 'John Doe',
      email: 'john@doe.com',
    },
  },
  {
    id: 3,
    name: 'Jupiter',
    description: 'The planet Jupiter',
    imageUrl: 'https://picsum.photos/200/300',
    creator: {
      id: '1',
      name: 'John Doe',
      email: 'john@doe.com',
    },
  },
]

export class PlanetService {
  list(limit: number, cursor: number): Planet[] {
    return planets.slice(cursor, cursor + limit)
  }

  find(id: number): Planet | undefined {
    return planets.find(planet => planet.id === id)
  }

  create(newPlanet: NewPlanet, creator: User = { id: '1', name: 'John Doe', email: 'john@doe.com' }): Planet {
    const id = planets.length + 1
    const imageUrl = newPlanet.image ? `https://example.com/cdn/${newPlanet.image.name}` : undefined

    const planet: Planet = {
      creator,
      id,
      name: newPlanet.name,
      description: newPlanet.description,
      imageUrl,
    }

    planets.push(planet)

    return planet
  }

  update(planet: UpdatePlanet): Planet {
    const index = planets.findIndex(p => p.id === planet.id)

    if (index === -1) {
      throw new Error('Planet not found')
    }

    planets[index] = {
      ...planets[index],
      ...planet,
      imageUrl: planet.image ? `https://example.com/cdn/${planet.image.name}` : planets[index].imageUrl,
    }

    return planets[index]
  }
}

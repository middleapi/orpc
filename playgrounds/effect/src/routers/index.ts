import { createPlanet, findPlanet, listPlanets } from './planet'

export const router = {
  planet: {
    list: listPlanets,
    find: findPlanet,
    create: createPlanet,
  },
}

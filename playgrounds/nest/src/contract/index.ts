import { me, signin, signup } from './auth'
import { createPlanet, findPlanet, listPlanets, updatePlanet } from './planet'
import { sse } from './sse'

export const contract = {
  auth: {
    signup,
    signin,
    me,
  },

  planet: {
    list: listPlanets,
    create: createPlanet,
    find: findPlanet,
    update: updatePlanet,
  },

  sse,
}

import { me, signin, signup } from './auth'
import { ping, pingVoid } from './ping'
import { createPlanet, findPlanet, listPlanets, updatePlanet } from './planet'
import { sse } from './sse'

export const router = {
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

  ping: {
    run: ping,
    runVoid: pingVoid,
  },
}

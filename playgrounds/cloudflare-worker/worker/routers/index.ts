import { me, signin, signup } from './auth'
import { onMessage, sendMessage } from './message'
import { onMessageV2, sendMessageV2 } from './message-v2'
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

  message: {
    on: onMessage,
    send: sendMessage,
  },

  messageV2: {
    on: onMessageV2,
    send: sendMessageV2,
  },
}

import { deleteFile, findFile, uploadFile } from './file'
import { publishMessage, subscribeMessages } from './message'
import { createPlanet, deletePlanet, findPlanet, listPlanets, searchPlanets, updatePlanet } from './planet'

export const router = {
  file: {
    find: findFile,
    upload: uploadFile,
    delete: deleteFile,
  },

  planet: {
    list: listPlanets,
    search: searchPlanets,
    find: findPlanet,
    create: createPlanet,
    update: updatePlanet,
    delete: deletePlanet,
  },

  message: {
    publish: publishMessage,
    subscribe: subscribeMessages,
  },
}

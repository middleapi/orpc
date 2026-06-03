import { lunariaPlanetsRouter } from './routers/planets'
import { lunariaStreamRouter } from './routers/stream'

export const lunariaRouter = {
  planets: lunariaPlanetsRouter,
  stream: lunariaStreamRouter,
}

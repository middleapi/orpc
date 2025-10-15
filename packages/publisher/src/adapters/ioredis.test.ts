import { Redis } from 'ioredis'
import { IORedisPublisher } from './ioredis'

describe('ioRedisPublisher', () => {
  const REDIS_URL = process.env.REDIS_URL
  if (!REDIS_URL) {
    throw new Error('There tests requires REDIS_URL env variable')
  }

  const commander = new Redis(REDIS_URL)
  const listener = new Redis(REDIS_URL)

  const publisher = new IORedisPublisher({
    commander,
    listener,
  })

  afterEach(async () => {
    await commander.flushall()
    await listener.flushall()
  })

  afterAll(async () => {
    commander.disconnect()
    listener.disconnect()
  })
})

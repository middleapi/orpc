import * as z from 'zod'
import { NewPlanetSchema, PlanetSchema, UpdatePlanetSchema } from '../schemas/planet'
import { oc } from '@orpc/contract'

export const listPlanets = oc
  .route({
    method: 'GET',
    path: '/planets',
    summary: 'List all planets',
    tags: ['Planets'],
  })
  .input(
    z.object({
      limit: z.number().int().min(1).max(100).default(10),
      cursor: z.number().int().min(0).default(0),
    }),
  )
  .output(z.array(PlanetSchema))

export const createPlanet = oc
  .route({
    method: 'POST',
    path: '/planets',
    summary: 'Create a planet',
    tags: ['Planets'],
  })
  .input(NewPlanetSchema)
  .output(PlanetSchema)

export const findPlanet = oc
  .route({
    method: 'GET',
    path: '/planets/{id}',
    summary: 'Find a planet',
    tags: ['Planets'],
  })
  .input(
    PlanetSchema.pick({ id: true }),
  )
  .output(PlanetSchema)

export const updatePlanet = oc
  .route({
    method: 'PUT',
    path: '/planets/{id}',
    summary: 'Update a planet',
    tags: ['Planets'],
  })
  .errors({
    NOT_FOUND: {
      message: 'Planet not found',
      data: z.object({ id: UpdatePlanetSchema.shape.id }),
    },
  })
  .input(UpdatePlanetSchema)
  .output(PlanetSchema)

import { ORPCError } from '@orpc/server'
import { oz } from '@orpc/zod'
import { z } from 'zod'
import { planets } from '../data/planet'
import { authed, pub } from '../orpc'
import {
  NewPlanetSchema,
  PlanetSchema,
  UpdatePlanetSchema,
} from '../schemas/planet'

export const listPlanets = pub
  .route({
    method: 'GET',
    path: '/',
    summary: 'List all planets',
  })
  .input(
    z.object({
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.number().int().min(0).default(0),
    }),
  )
  .output(oz.openapi(z.array(PlanetSchema), { examples: [planets] }))
  .handler(async (input, context, meta) => {
    return planets
  })

export const createPlanet = authed
  .route({
    method: 'POST',
    path: '/',
    summary: 'Create a planet',
  })
  .input(NewPlanetSchema)
  .output(PlanetSchema)
  .handler(async (input, context, meta) => {
    const id = planets.length + 1

    const planet = {
      id,
      name: input.name,
      description: input.description,
      imageUrl: input.image ? 'https://picsum.photos/200/300' : undefined,
      creator: context.user,
    }

    planets.push(planet)

    return planet
  })

export const findPlanet = pub
  .route({
    method: 'GET',
    path: '/{id}',
    summary: 'Find a planet',
  })
  .input(
    z.object({
      id: z.number().int().min(1),
    }),
  )
  .output(PlanetSchema)
  .handler(async (input, context, meta) => {
    const planet = planets.find(planet => planet.id === input.id)

    if (!planet) {
      throw new ORPCError({
        code: 'NOT_FOUND',
        message: 'Planet not found',
      })
    }

    return planet
  })

export const updatePlanet = authed
  .route({
    method: 'PUT',
    path: '/{id}',
    summary: 'Update a planet',
  })
  .input(UpdatePlanetSchema)
  .output(PlanetSchema)
  .handler(async (input, context, meta) => {
    const planet = planets.find(planet => planet.id === input.id)

    if (!planet) {
      throw new ORPCError({
        code: 'NOT_FOUND',
        message: 'Planet not found',
      })
    }

    planet.name = input.name ?? planet.name
    planet.description = input.description ?? planet.description
    planet.imageUrl = input.image ? 'https://picsum.photos/200/300' : undefined

    return planet
  })

export const updatePlanetImage = authed
  .route({
    method: 'PATCH',
    path: '/{id}/image',
    summary: 'Update a planet image',
  })
  .input(
    z.object({
      id: z.number().int().min(1),
      image: oz.file().type('image/*').optional(),
    }),
  )
  .output(PlanetSchema)
  .handler(async (input, context, meta) => {
    const planet = planets.find(planet => planet.id === input.id)

    if (!planet) {
      throw new ORPCError({
        code: 'NOT_FOUND',
        message: 'Planet not found',
      })
    }

    planet.imageUrl = input.image ? 'https://picsum.photos/200/300' : undefined

    return planet
  })

export const deletePlanet = authed
  .route({
    method: 'DELETE',
    path: '/{id}',
    summary: 'Delete a planet',
    deprecated: true,
  })
  .input(
    z.object({
      id: z.number().int().min(1),
    }),
  )
  .handler(async (input, context, meta) => {
    const planet = planets.find(planet => planet.id === input.id)

    if (!planet) {
      throw new ORPCError({
        code: 'NOT_FOUND',
        message: 'Planet not found',
      })
    }

    planets.splice(planets.indexOf(planet), 1)
  })

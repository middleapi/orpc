'use server'

import { createFormAction } from '@orpc/next'
import { ORPCError } from '@orpc/server'
import { oz, ZodCoercer } from '@orpc/zod'
import { z } from 'zod'
import { planets } from '../data/planet'
import { authed, pub } from '../orpc'
import {
  NewPlanetSchema,
  PlanetSchema,
  UpdatePlanetSchema,
} from '../schemas/planet'

export const listPlanets = pub
  .input(
    z.object({
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.number().int().min(0).default(0),
    }),
  )
  .output(z.array(PlanetSchema))
  .handler(async (input, context, meta) => {
    return planets
  })

export const createPlanet = authed
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

export const createPlanetFA = createFormAction({
  procedure: createPlanet,
  schemaCoercers: [new ZodCoercer()],
  onSuccess(output) {
    // redirect('/planets')
  },
})

export const findPlanet = pub
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

import { oc } from '@orpc/contract'
import * as z from 'zod'
import { NewPlanetSchema, PlanetSchema, UpdatePlanetSchema } from '../schemas/planet'

export const lunariaPlanetsContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/apps/lunaria/planets',
      summary: 'List Lunaria planets',
      tags: ['Lunaria'],
    })
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(10),
        cursor: z.number().int().min(0).default(0),
      }),
    )
    .output(z.array(PlanetSchema)),

  create: oc
    .route({
      method: 'POST',
      path: '/apps/lunaria/planets',
      summary: 'Create a Lunaria planet',
      tags: ['Lunaria'],
    })
    .input(NewPlanetSchema)
    .output(PlanetSchema),

  find: oc
    .route({
      method: 'GET',
      path: '/apps/lunaria/planets/{id}',
      summary: 'Find a Lunaria planet',
      tags: ['Lunaria'],
    })
    .input(
      z.object({
        id: z.number().int().min(1),
      }),
    )
    .output(PlanetSchema),

  update: oc
    .route({
      method: 'PUT',
      path: '/apps/lunaria/planets/{id}',
      summary: 'Update a Lunaria planet',
      tags: ['Lunaria'],
    })
    .errors({
      NOT_FOUND: {
        message: 'Planet not found',
        data: z.object({ id: UpdatePlanetSchema.shape.id }),
      },
    })
    .input(UpdatePlanetSchema)
    .output(PlanetSchema),
}

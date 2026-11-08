// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'
import * as z from 'zod'

import type { Planet, PlanetKind } from '@/models/planet'

const planets: Planet[] = []

export const planetRouter = {
  /**
   * Find a planet
   * Looks a planet up by its id.
   */
  find: os
    .route({ method: 'GET', path: '/planets/{id}' })
    .input(type<{ id: number }>())
    .handler(async ({ input }) => planets.find((p) => p.id === input.id) ?? null),

  /**
   * @deprecated use find
   * @tags planets, legacy
   */
  list: os
    .route({ method: 'GET', path: '/planets' })
    .input(
      z.object({ limit: z.number().int().optional(), kind: z.enum(['rocky', 'gas']).optional() }),
    )
    .handler(({ input }) => ({ items: planets, kind: input.kind as PlanetKind | undefined })),

  /** Create a planet */
  create: os
    .route({ method: 'POST', path: '/planets', summary: 'Summary from route', successStatus: 201 })
    .errors({
      CONFLICT: { message: 'already exists', data: type<{ existingId: number }>() },
      FORBIDDEN: { data: z.object({ reason: z.string() }) },
    })
    .input(type<Omit<Planet, 'id' | 'moons'>>())
    .handler(({ input }) => ({ ...input, id: 1, moons: [] }) satisfies Planet as Planet),
}

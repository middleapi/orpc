import { openapi } from '@orpc/openapi'
import { Effect, Schema } from 'effect'
import { base } from '../orpc'
import { NewPlanetSchema, PlanetSchema } from '../schemas/planet'
import { PlanetRepo } from '../services'

export const listPlanets = base
  .meta(openapi({
    method: 'GET',
    path: '/planets',
    summary: 'List all planets',
    tags: ['Planet'],
  }))
  .input(Schema.Struct({
    limit: Schema.optionalKey(Schema.Number),
    cursor: Schema.optionalKey(Schema.Number),
  }))
  .output(Schema.Array(PlanetSchema))
  .effect(function* (_, input) {
    const repo = yield* PlanetRepo
    return yield* repo.list({ limit: input.limit ?? 10, cursor: input.cursor ?? 0 })
  })

export const findPlanet = base
  .meta(openapi({
    method: 'GET',
    path: '/planets/{id}',
    summary: 'Find a planet',
    tags: ['Planet'],
  }))
  .errors({ NOT_FOUND: { message: 'Planet not found' } })
  .input(Schema.Struct({ id: Schema.String }))
  .output(PlanetSchema)
  .effect(function* ({ errors }, input) {
    const repo = yield* PlanetRepo
    const planet = yield* repo.find(input.id)

    if (!planet) {
      return yield* Effect.fail(errors.NOT_FOUND())
    }

    return planet
  })

export const createPlanet = base
  .meta(openapi({
    method: 'POST',
    path: '/planets',
    summary: 'Create a new planet',
    tags: ['Planet'],
  }))
  .input(NewPlanetSchema)
  .output(PlanetSchema)
  .effect(function* (_, input) {
    const repo = yield* PlanetRepo
    return yield* repo.create(input)
  })

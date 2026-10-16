import { Schema } from 'effect'

export type NewPlanet = typeof NewPlanetSchema.Type
export type Planet = typeof PlanetSchema.Type

export const NewPlanetSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.String,
})

export const PlanetSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
})

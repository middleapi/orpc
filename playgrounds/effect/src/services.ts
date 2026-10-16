import type { NewPlanet, Planet } from './schemas/planet'
import { Context, Effect, Layer, Ref } from 'effect'

export class IdGenerator extends Context.Service<
  IdGenerator,
  {
    readonly next: Effect.Effect<string>
  }
>()('IdGenerator') {
  static readonly layer = Layer.succeed(IdGenerator, {
    next: Effect.sync(() => crypto.randomUUID()),
  })
}

export class PlanetRepo extends Context.Service<
  PlanetRepo,
  {
    readonly list: (options: { limit: number, cursor: number }) => Effect.Effect<ReadonlyArray<Planet>>
    readonly find: (id: string) => Effect.Effect<Planet | undefined>
    readonly create: (planet: NewPlanet) => Effect.Effect<Planet>
  }
>()('PlanetRepo') {
  /**
   * An in-memory repository. Swap this layer for one backed by a real database,
   * the procedures only depend on the `PlanetRepo` service.
   */
  static readonly layer = Layer.effect(PlanetRepo, Effect.gen(function* () {
    const ids = yield* IdGenerator
    const planets = yield* Ref.make<ReadonlyArray<Planet>>([
      { id: 'earth', name: 'Earth', description: 'The planet Earth' },
      { id: 'mars', name: 'Mars', description: 'The planet Mars' },
    ])

    return {
      list: ({ limit, cursor }) => Ref.get(planets).pipe(
        Effect.map(all => all.slice(cursor, cursor + limit)),
      ),
      find: id => Ref.get(planets).pipe(
        Effect.map(all => all.find(planet => planet.id === id)),
      ),
      create: planet => Effect.gen(function* () {
        const created = { id: yield* ids.next, ...planet }
        yield* Ref.update(planets, all => [...all, created])
        return created
      }),
    }
  })).pipe(
    Layer.provide(IdGenerator.layer),
  )
}

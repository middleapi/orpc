import type { NewPlanet, Planet, UpdatePlanet } from '../../../../shared/apps/lunaria/schemas/planet'
import type { User } from '#shared/schemas/user'
import { asc, eq, gt } from 'drizzle-orm'
import { db } from '../../../db/client'
import { planets, users } from '../../../db/schema'

export interface PlanetRepository {
  find: (id: number) => Promise<Planet | undefined>
  list: (limit: number, cursor: number) => Promise<Planet[]>
  create: (newPlanet: NewPlanet, creator: User) => Promise<Planet>
  update: (updatePlanet: UpdatePlanet) => Promise<Planet>
}

type PlanetWithCreator = {
  planet: typeof planets.$inferSelect
  creator: typeof users.$inferSelect
}

function toUser(user: typeof users.$inferSelect): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email
  }
}

function toPlanet(row: PlanetWithCreator): Planet {
  return {
    id: row.planet.id,
    name: row.planet.name,
    description: row.planet.description ?? undefined,
    imageUrl: row.planet.imageUrl ?? undefined,
    creator: toUser(row.creator)
  }
}

async function ensureUser(user: User) {
  await db
    .insert(users)
    .values(user)
    .onConflictDoNothing()
}

function selectPlanetWithCreator() {
  return db
    .select({
      planet: planets,
      creator: users
    })
    .from(planets)
    .innerJoin(users, eq(planets.creatorId, users.id))
}

async function findPlanet(id: number): Promise<Planet | undefined> {
  const [row] = await selectPlanetWithCreator()
    .where(eq(planets.id, id))
    .limit(1)

  return row ? toPlanet(row) : undefined
}

export function createPlanetRepository(): PlanetRepository {
  return {
    find: findPlanet,
    list: async (limit: number, cursor: number) => {
      const rows = await selectPlanetWithCreator()
        .where(gt(planets.id, cursor))
        .orderBy(asc(planets.id))
        .limit(limit)

      return rows.map(toPlanet)
    },
    create: async (newPlanet, creator) => {
      await ensureUser(creator)

      const imageUrl = newPlanet.image ? `https://example.com/cdn/${newPlanet.image.name}` : undefined

      const [planet] = await db
        .insert(planets)
        .values({
          name: newPlanet.name,
          description: newPlanet.description,
          imageUrl,
          creatorId: creator.id
        })
        .returning()

      return toPlanet({
        planet: planet!,
        creator: {
          id: creator.id,
          name: creator.name,
          email: creator.email,
          password: '',
          emailVerified: false,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      })
    },
    update: async (planet) => {
      await db
        .update(planets)
        .set({
          name: planet.name,
          description: planet.description ?? null,
          ...(planet.image
            ? { imageUrl: `https://example.com/cdn/${planet.image.name}` }
            : {}),
          updatedAt: new Date()
        })
        .where(eq(planets.id, planet.id))

      const updated = await findPlanet(planet.id)

      if (!updated) {
        throw new Error('Planet not found')
      }

      return updated
    }
  }
}

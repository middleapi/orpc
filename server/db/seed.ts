import { eq, sql } from 'drizzle-orm'
import { auth } from '../auth'
import { closeDatabaseConnection, db } from './client'
import { planets, users } from './schema'

async function seed() {
  let user = await auth.api.signInEmail({
    body: {
      email: 'john@doe.com',
      password: '123456',
    },
  }).then(result => result.user).catch(() => undefined)

  if (!user) {
    await db.delete(users).where(eq(users.email, 'john@doe.com'))

    const result = await auth.api.signUpEmail({
      body: {
        name: 'John Doe',
        email: 'john@doe.com',
        password: '123456',
      },
    })

    user = result.user
  }

  await db
    .insert(planets)
    .values([
      {
        id: 1,
        name: 'Earth',
        description: 'The planet Earth',
        imageUrl: 'https://picsum.photos/200/300',
        creatorId: user.id,
      },
      {
        id: 2,
        name: 'Mars',
        description: 'The planet Mars',
        imageUrl: 'https://picsum.photos/200/300',
        creatorId: user.id,
      },
      {
        id: 3,
        name: 'Jupiter',
        description: 'The planet Jupiter',
        imageUrl: 'https://picsum.photos/200/300',
        creatorId: user.id,
      },
    ])
    .onConflictDoNothing()

  await db.execute(sql`
    select setval(
      pg_get_serial_sequence('lunaria.planets', 'id'),
      coalesce((select max(id) from lunaria.planets), 1)
    )
  `)
}

seed()
  .then(async () => {
    await closeDatabaseConnection()
  })
  .catch(async (error) => {
    console.error(error)
    await closeDatabaseConnection()
    process.exit(1)
  })

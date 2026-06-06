import type { User } from './schemas/user'
import { and, eq, gt } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db/client'
import { sessions, users } from './db/schema'

const defaultPlaygroundUser: User = {
  id: 'default-playground-user',
  name: 'John Doe',
  email: 'john@doe.com'
}

function toUser(user: Pick<typeof users.$inferSelect, 'id' | 'name' | 'email'>): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email
  }
}

async function getUserFromAuthorization(authorization?: string | null): Promise<User | undefined> {
  if (!authorization) {
    return undefined
  }

  const token = authorization.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return undefined
  }

  if (token === 'default-token') {
    const [row] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email
      })
      .from(users)
      .where(eq(users.email, defaultPlaygroundUser.email))
      .limit(1)

    return row ? toUser(row) : defaultPlaygroundUser
  }

  const [row] = await db
    .select({
      user: {
        id: users.id,
        name: users.name,
        email: users.email
      }
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.token, token),
      gt(sessions.expiresAt, new Date())
    ))
    .limit(1)

  return row ? toUser(row.user) : undefined
}

export async function getUserFromRequest(headers: Headers): Promise<User | undefined> {
  const session = await auth.api.getSession({ headers })

  if (session?.user) {
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email
    }
  }

  return getUserFromAuthorization(headers.get('authorization'))
}

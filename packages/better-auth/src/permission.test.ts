import type { RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext } from '@orpc/server/plugins'
import { call, defineMeta, ORPCError, os } from '@orpc/server'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { admin } from 'better-auth/plugins/admin'
import { requireSession } from './middleware'

/**
 * Mirrors the "Permissions" example of the Better Auth integration docs.
 */
const auth = betterAuth({
  baseURL: 'http://localhost',
  secret: 'better-auth-secret-for-orpc-integration-tests',
  database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  emailAndPassword: { enabled: true },
  plugins: [admin()],
  logger: { disabled: true },
})

interface ServerContext extends RequestHeadersHandlerPluginContext, ResponseHeadersHandlerPluginContext {}

const base = os.$context<ServerContext>()

type Permissions = Record<string, string[]>

const [permissionMeta, getPermissionMeta] = defineMeta(
  'permission',
  (incoming: Permissions, current) => ({ ...current, ...incoming }),
)

const requirePermission = requireSession({ auth }).use(async ({ context, procedure, next }) => {
  const permissions = getPermissionMeta(procedure)

  if (permissions) {
    const { success } = await auth.api.userHasPermission({
      body: { userId: context.session.user.id, permissions },
    })

    if (!success) {
      throw new ORPCError('FORBIDDEN')
    }
  }

  return next()
})

const router = {
  listUsers: base
    .use(requirePermission)
    .meta(permissionMeta({ user: ['list'] }))
    .handler(() => 'users'),

  me: base
    .use(requirePermission)
    .handler(({ context }) => context.session.user.email),
}

async function signUp(email: string) {
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: 'password-1234', name: 'Ada' },
    returnHeaders: true,
  })

  const cookie = headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')

  return { cookie, userId: response.user.id }
}

describe('permissions with meta and requireSession().use()', () => {
  it('checks the permissions in the procedure meta', async () => {
    const { cookie, userId } = await signUp('permission@example.com')
    const context = () => ({ reqHeaders: new Headers({ cookie }) })

    await expect(call(router.listUsers, undefined, { context: context() })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await call(router.me, undefined, { context: context() })).toBe('permission@example.com')

    const { internalAdapter } = await auth.$context
    await internalAdapter.updateUser(userId, { role: 'admin' })

    expect(await call(router.listUsers, undefined, { context: context() })).toBe('users')
  })

  it('rejects unauthenticated calls before checking permissions', async () => {
    const spy = vi.spyOn(auth.api, 'userHasPermission')

    await expect(call(router.listUsers, undefined, { context: { reqHeaders: new Headers() } }))
      .rejects
      .toMatchObject({ code: 'UNAUTHORIZED' })

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

import { authed } from '../orpc'

export const platformRouter = {
  me: authed
    .platform
    .me
    .handler(({ context }) => {
      return context.user
    })
}

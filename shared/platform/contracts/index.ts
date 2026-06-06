import { oc } from '@orpc/contract'
import { UserSchema } from '../../schemas/user'

export const platformContract = {
  me: oc
    .route({
      method: 'GET',
      path: '/platform/me',
      summary: 'Get the current platform user',
      tags: ['Platform']
    })
    .output(UserSchema)
}

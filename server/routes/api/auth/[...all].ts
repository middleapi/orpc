import { auth } from '../../../auth'

export default defineEventHandler((event) => {
  if (getRequestURL(event).pathname.startsWith('/api/auth/open-api')) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found'
    })
  }

  return auth.handler(toWebRequest(event))
})

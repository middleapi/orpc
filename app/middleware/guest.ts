type SessionResponse = {
  user?: unknown
} | null

export default defineNuxtRouteMiddleware(async () => {
  const session = await $fetch<SessionResponse>('/api/auth/get-session', {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  }).catch(() => null)

  if (session?.user) {
    return navigateTo('/apps')
  }
})

import type { NodeHttpRequest } from './types'
import { guard } from '@orpc/shared'

export function toStandardUrl(req: NodeHttpRequest): URL {
  const protocol = ('encrypted' in req.socket && req.socket.encrypted ? 'https:' : 'http:')

  // Defensive fallback for malformed input
  const origin = guard(() => new URL(`${protocol}//${req.headers.host ?? 'localhost'}`).origin) ?? 'http://localhost'

  const path = req.originalUrl ?? req.url ?? '/'

  return new URL(`${origin}${path.startsWith('/') ? '' : '/'}${path}`)
}

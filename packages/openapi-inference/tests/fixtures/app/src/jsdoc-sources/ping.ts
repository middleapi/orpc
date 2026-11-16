import { os } from '@orpc/server'

/**
 * Ping the server
 * Returns pong.
 * @tags health
 */
export const ping = os.handler(() => 'pong' as const)

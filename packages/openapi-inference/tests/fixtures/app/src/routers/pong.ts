import { os } from '@orpc/server'

/**
 * Pong
 * Answers with pong.
 */
export const pong = os.handler(() => 'pong')

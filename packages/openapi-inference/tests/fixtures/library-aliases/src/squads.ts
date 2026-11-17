import { os } from '@orpc/server'
import type { InferSelectModel } from 'fake-orm'

import type { teams } from './teams'

// a second alias of the type of `Team`
export type Squad = InferSelectModel<typeof teams>

export const squadList = os.handler(async (): Promise<Squad[]> => [])

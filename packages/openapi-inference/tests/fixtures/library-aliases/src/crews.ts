import { os } from '@orpc/server'
import type { InferSelectModel } from 'fake-orm'

import type { CrewHolder } from './crew-holder'
import type { crews } from './crew-tables'

// a type converted before the file declaring its alias is read, through a later procedure only
const direct = os.handler((): InferSelectModel<typeof crews>[] => [])
const held = os.handler((): CrewHolder => ({ crew: { id: 1, name: 'n' } }))

export const crewsHeldLast = { direct, held }
export const crewsHeldFirst = { held, direct }
export const crewsLazy = { direct: os.lazy(async () => ({ default: direct })), held }

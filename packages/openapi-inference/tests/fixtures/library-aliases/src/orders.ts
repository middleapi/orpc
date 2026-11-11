import { os, type } from '@orpc/server'
import type { InferSelectModel } from 'fake-orm'

import type { User as ApiUser } from './api-user'
import type { Holder } from './holder'
import { squadList } from './squads'
import type { teams, User } from './teams'
import { teamList } from './teams'

const rows = os.handler((): User[] => [])
// instantiated anew where the compiler awaits or infers it
const rowsAsync = os.handler(async (): Promise<User[]> => [])
const createRow = os.input(type<User>()).handler(() => 1)
const api = os.handler((): ApiUser[] => [])

// a declared type keeps its name, whichever procedure comes first
export const collision = { rows, rowsAsync, createRow, api }
export const collisionReversed = { api, createRow, rowsAsync, rows }

// a type reached before the file of a property importing its alias is read
const direct = os.handler((): InferSelectModel<typeof teams>[] => [])
const held = os.handler((): Holder => ({ team: { id: 1, title: 't' } }))

export const heldLast = { direct, held }
export const heldFirst = { held, direct }

// two aliases of one type, of the files of two procedures
export const aliases = { teams: teamList, squads: squadList }
export const aliasesReversed = { squads: squadList, teams: teamList }

import { os } from '@orpc/server'
import type { Column, InferSelectModel, Table } from 'fake-orm'

export declare const members: Table<{ id: Column<number>; handle: Column<string> }>
export declare const teams: Table<{ id: Column<number>; title: Column<string> }>

// an alias another file declares a type of the same name of
export type User = InferSelectModel<typeof members>
export type Team = InferSelectModel<typeof teams>

export const teamList = os.handler(async (): Promise<Team[]> => [])

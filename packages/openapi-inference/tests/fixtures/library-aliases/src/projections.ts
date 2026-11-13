import { os } from '@orpc/server'
import type { Column, InferSelectModel, Table } from 'fake-orm'

declare const labels: Table<{ id: Column<number>; name: Column<string> }>
declare const people: Table<{ id: Column<number>; name: Column<string>; email: Column<string> }>

export type Label = InferSelectModel<typeof labels>

// a model of other columns with the same fields, like a relation selecting some columns, which
// no alias names
declare function summary(): InferSelectModel<Table<Pick<(typeof people)['columns'], 'id' | 'name'>>>

const label = os.handler((): Label => ({ id: 1, name: 'news' }))
// the same model, instantiated anew
const labelsAsync = os.handler(async (): Promise<Label[]> => [])
const labelRows = os.handler((): InferSelectModel<typeof labels>[] => [])
const author = os.handler(() => summary())
const post = os.handler(() => ({ title: 't', author: summary(), labels: [] as Label[] }))

export const projections = { label, labelsAsync, labelRows, author, post }
export const projectionsReversed = { post, author, labelRows, labelsAsync, label }

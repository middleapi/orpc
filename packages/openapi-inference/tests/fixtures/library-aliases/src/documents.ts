import { os } from '@orpc/server'
import type { InferDocument, Schema } from 'fake-orm'

declare const noteSchema: Schema<{ title: string }>

// an intersection, of the fields and the timestamps
export type Note = InferDocument<typeof noteSchema>

export const documents = {
  note: os.handler((): Note => ({ title: 't', createdAt: new Date(), updatedAt: new Date() })),
  notes: os.handler(async (): Promise<Note[]> => []),
  held: os.handler((): { note: Note } => ({
    note: { title: 't', createdAt: new Date(), updatedAt: new Date() },
  })),
}

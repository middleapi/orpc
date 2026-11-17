import { os } from '@orpc/server'
import type { DecimalLike, InferDocument, Schema } from 'fake-orm'

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

// an interface keeps its own name
export type Amount = DecimalLike

export const named = {
  amount: os.handler((): Amount => ({ digits: [1], exponent: 0 })),
}

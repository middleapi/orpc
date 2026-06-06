import { relations } from 'drizzle-orm'
import { pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './shared'

export const lunariaSchema = pgSchema('lunaria')

export const planets = lunariaSchema.table('planets', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  imageUrl: text('image_url'),
  creatorId: text('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const planetsRelations = relations(planets, ({ one }) => ({
  creator: one(users, {
    fields: [planets.creatorId],
    references: [users.id]
  })
}))

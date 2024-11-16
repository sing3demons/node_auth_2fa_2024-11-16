import { boolean, pgTable, serial, varchar } from 'drizzle-orm/pg-core'

export const usersTable = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull().unique(),
  password: varchar({ length: 255 }).notNull(),
  role: varchar({ length: 20 }).default('member'),
  '2faEnable': boolean().default(false),
  '2faSecret': varchar({ length: 255 }),
})

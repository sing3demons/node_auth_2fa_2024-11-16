import { drizzle } from 'drizzle-orm/node-postgres'
import config from '../config.js'

const db = drizzle(config.get('db').url)

export { db }

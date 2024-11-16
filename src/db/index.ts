import { drizzle } from 'drizzle-orm/node-postgres'
import config from '../config'

const db = drizzle(config.get('db').url)

export { db }

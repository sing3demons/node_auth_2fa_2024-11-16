import { createClient, RedisClientType } from 'redis'
import config from '../config.js'

const cache: RedisClientType = createClient({
  url: config.get('redis_url'),
})

cache.on('error', (err) => console.log('Redis Client Error', err))

cache.on('connect', () => console.log('Redis Client Connected'))

// const connRedis = async (): Promise<void> => await cache.connect();
async function connRedis() {
  await cache.connect()
}

async function disconnectRedis() {
  return await cache.disconnect()
}

export { cache, connRedis, disconnectRedis }

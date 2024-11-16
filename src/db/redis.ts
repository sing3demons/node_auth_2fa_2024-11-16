import { createClient } from 'redis';
import config from '../config';

const cache = createClient({
    url: config.get('redis_url')
});

cache.on('error', err => console.log('Redis Client Error', err));

cache.on('connect', () => console.log('Redis Client Connected'));



const connRedis = async () => await cache.connect();
const disconnectRedis = async () => await cache.disconnect();

export { cache, connRedis, disconnectRedis };

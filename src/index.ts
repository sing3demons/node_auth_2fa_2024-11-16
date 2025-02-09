import config from "./config"
import { connRedis } from "./db/redis"
import AppServer from "./lib/route"
import route from "./server"

const app = new AppServer(async () => {
  await connRedis()
})

app.router(route).listen(config.get('port'))
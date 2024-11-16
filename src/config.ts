import 'dotenv/config';

type IConfig = {
  [key: string]: any
  port?: number
  app_name: string
  db: {
    url: string
    dialect: 'postgresql' | 'mysql' | 'sqlite' | 'mssql'
  }
  accessTokenSecret: string
  accessTokenExpiresIn: string
  refreshTokenSecret: string
  refreshTokenExpiresIn: string
  cacheTemporaryTokenPrefix: string
  redis_url?: string
}

type ConfigKey = keyof IConfig

class Config {
  private static _instance: Config
  private _config: IConfig
  private constructor() {
    this._config = {
      app_name: process.env.APP_NAME || '',
      port: 3000,
      db: {
        url: '',
        dialect: 'postgresql',
      },
      accessTokenSecret: 'myAccessTokenSecret',
      accessTokenExpiresIn: '30m',

      refreshTokenSecret: 'myRefreshTokenSecret',
      refreshTokenExpiresIn: '1w',

      cacheTemporaryTokenPrefix: 'token:',
      cacheTemporaryTokenExpiresInSeconds: 180,
    }
  }
  public static getInstance(): Config {
    if (!Config._instance) {
      Config._instance = new Config()
    }
    return Config._instance
  }
  public set<T extends ConfigKey>(key: T, value: any): void {
    this._config[key] = value
  }
  public get<K extends ConfigKey>(key: K) {
    return this._config[key]
  }
}

const config = Config.getInstance()
config.set('port', parseInt(process.env.PORT!))
config.set('db', {
  url: process.env.DATABASE_URL!,
  dialect: 'postgresql',
})

config.set('redis_url', process.env.REDIS_URL)

export default config

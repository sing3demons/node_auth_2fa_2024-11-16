import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { usersTable } from './db/schema'
import { NextFunction, Request, Response } from 'express'
import config from './config'
import { db } from './db'
import bcrypt from 'bcrypt'
import { cache, connRedis } from './db/redis'
import jwt from 'jsonwebtoken'
import { authenticator } from 'otplib'
import crypto from 'crypto'
import QRCode from 'qrcode'
import AppServer, { AppRouter, generateXTid, Type } from './lib/route'
import { HttpService, RequestAttributes } from './lib/http-service'
import CMD_NAME from './lib/constants/commandName'
import NODE_NAME from './lib/constants/modeName'

const route = new AppRouter()

const registerSchema = Type.Object({
  name: Type.String(),
  email: Type.String(),
  password: Type.String(),
})

const loginSchema = Type.Object({
  email: Type.String(),
  password: Type.String(),
})

const app = new AppServer(async () => {
  await connRedis()
})

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    res.status(401).json({ message: 'Access token is required' })
    return
  }

  const user = jwt.verify(token, config.get('accessTokenSecret')) as { id: string; email: string } | null
  if (!user) {
    res.status(403).json({ message: 'Invalid token' })
    return
  }

  req.userId = user.id
  return next()
}

route.post(
  '/api/auth/register',
  async ({ body: { name, email, password }, res, req }) => {
    const detailLog = req.detailLog.New(CMD_NAME.REGISTER)
    const summaryLog = req.summaryLog.New(CMD_NAME.REGISTER)
    const initInvoke = generateXTid('auth')

    detailLog.addInputRequest(NODE_NAME.CLIENT, CMD_NAME.REGISTER, initInvoke, req)

    const sql = db.select().from(usersTable).where(eq(usersTable.email, email)).toSQL()
    const checkUser = await db.select().from(usersTable).where(eq(usersTable.email, email))
    detailLog.addOutputResponse(NODE_NAME.POSTGRES, CMD_NAME.GET_USER, initInvoke, '', sql).end()
    summaryLog.addSuccessBlock(NODE_NAME.POSTGRES, CMD_NAME.GET_USER, '2000', 'success')
    detailLog.addInputResponse(NODE_NAME.POSTGRES, CMD_NAME.GET_USER, initInvoke, '', checkUser)

    if (checkUser.length > 0) {
      console.log(checkUser)
      res.status(409).json({ message: 'Email already exists' })
      return
    }
    const hashedPassword = await bcrypt.hash(password, 10)

    const body: typeof usersTable.$inferInsert = {
      name,
      email,
      password: hashedPassword,
      role: 'member',
      '2faEnable': false,
    }

    const user = await db.insert(usersTable).values(body)

    res.json(user)
  },
  {
    body: registerSchema,
  }
)

route.post(
  '/api/auth/login',
  async ({ body: { email, password }, res, req }) => {
    const detailLog = req.detailLog.New(CMD_NAME.LOGIN)
    const summaryLog = req.summaryLog.New(CMD_NAME.LOGIN)
    const initInvoke = generateXTid('auth')

    detailLog.addInputRequest(NODE_NAME.CLIENT, CMD_NAME.LOGIN, initInvoke, req)
    summaryLog.addSuccessBlock(NODE_NAME.CLIENT, CMD_NAME.LOGIN, '2000', 'success')

    let cmd = 'select_user',
      invoke = generateXTid('pg')
    const sql = db.select().from(usersTable).where(eq(usersTable.email, email)).toSQL()
    detailLog.addOutputRequest(NODE_NAME.POSTGRES, cmd, invoke, '', sql)
    detailLog.end()
    const users = await db.select().from(usersTable).where(eq(usersTable.email, email))

    detailLog.addInputResponse(NODE_NAME.POSTGRES, cmd, invoke, '', users)

    if (users.length !== 1) {
      summaryLog.addErrorBlock(NODE_NAME.POSTGRES, cmd, '40100', 'Email or password is invalid')
      res.status(401).json({ message: 'Email or password is invalid' })
      return
    }

    const user = users[0]
    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      summaryLog.addErrorBlock('postgres', cmd, '40100', 'Email or password is invalid')
      res.status(401).json({ message: 'Email or password is invalid' })
      return
    }

    summaryLog.addSuccessBlock('postgres', cmd, '2000', 'success')

    const optionAttributes: RequestAttributes[] = []
    invoke = generateXTid('x')
    cmd = 'get_x'
    for (let i = 1; i <= 30; i++) {
      const option: RequestAttributes = {
        _command: cmd,
        _invoke: invoke,
        _service: NODE_NAME.GO_SERVER,
        url: `http://localhost:8081/x/${i}`,
        headers: { 'Content-Type': 'application/json' },
        method: 'GET',
      }

      optionAttributes.push(option)
    }

    const data = await HttpService.requestHttp(optionAttributes, detailLog, summaryLog)

    for (let i = 0; i < data.length; i++) {
      summaryLog.addSuccessBlock(NODE_NAME.GO_SERVER, cmd, data[i].Status.toString().padEnd(5, '0'), 'success')
    }

    if (user['2faEnable']) {
      const tempToken = crypto.randomUUID()
      const key = `${config.get('cacheTemporaryTokenPrefix')}${tempToken}`
      const exp = config.get('cacheTemporaryTokenExpiresInSeconds')

      const r = await cache.set(key, user.id, { EX: exp })

      const data = {
        tempToken,
        email: user.email,
        redis: r,
      }

      summaryLog.addSuccessBlock(NODE_NAME.CLIENT, CMD_NAME.LOGIN, '2000', 'success')

      res.json({ token: tempToken })
      return
    }

    const accessTokenSecret = config.get('accessTokenSecret')
    const expiresIn = config.get('accessTokenExpiresIn')
    const refreshTokenSecret = config.get('refreshTokenSecret')
    const refreshTokenExpiresIn = config.get('refreshTokenExpiresIn')
    const payload = {
      id: user.id,
      email: user.email,
    }

    const accessToken = jwt.sign(payload, accessTokenSecret, { expiresIn })
    const refreshToken = jwt.sign(payload, refreshTokenSecret, {
      expiresIn: refreshTokenExpiresIn,
    })

    const result = {
      access_token: accessToken,
      refresh_token: refreshToken,
    }

    summaryLog.addSuccessBlock(NODE_NAME.CLIENT, CMD_NAME.LOGIN, '2000', 'success')

    res.status(200).json(result)
  },
  { body: loginSchema }
)

route.post(
  '/api/auth/login/2fa',
  async ({ body: { tempToken, totp }, res }) => {
    const key = `${config.get('cacheTemporaryTokenPrefix')}${tempToken}`
    const userId = await cache.get(key)

    if (!userId) {
      res.status(401).json({
        message: 'The provided temporary token is incorrect or expired',
      })
      return
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.id, userId))

    if (users.length !== 1) {
      res.status(401).json({ message: 'Email or password is invalid' })
      return
    }

    const user = users[0]
    if (!user['2faEnable']) {
      res.status(401).json({ message: '2FA is not enabled for this user' })
      return
    }

    const secret = user['2faSecret']
    if (!secret) {
      res.status(401).json({ message: '2FA secret is not set for this user' })
      return
    }

    const verified = authenticator.check(totp, secret)

    if (!verified) {
      res.status(401).json({ message: 'The provided TOTP is incorrect or expired' })
      return
    }

    const accessTokenSecret = config.get('accessTokenSecret')
    const expiresIn = config.get('accessTokenExpiresIn')
    const refreshTokenSecret = config.get('refreshTokenSecret')
    const refreshTokenExpiresIn = config.get('refreshTokenExpiresIn')
    const payload = {
      id: user.id,
      email: user.email,
    }

    const accessToken = jwt.sign(payload, accessTokenSecret, { expiresIn })
    const refreshToken = jwt.sign(payload, refreshTokenSecret, {
      expiresIn: refreshTokenExpiresIn,
    })

    res.status(200).json({
      id: user.id,
      name: user.name,
      email: user.email,
      access_token: accessToken,
      refresh_token: refreshToken,
    })
  },
  {
    body: Type.Object({
      tempToken: Type.String(),
      totp: Type.String(),
    }),
  }
)

route.get(
  '/api/auth/2fa/generate',
  async ({ res, req }) => {
    const id = req.userId
    if (!id) {
      res.status(422).json({ message: 'Please provide the user id' })
      return
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.id, id))

    if (users.length !== 1) {
      res.status(401).json({ message: 'Email or password is invalid' })
      return
    }

    const user = users[0]

    const secret = authenticator.generateSecret()
    const uri = authenticator.keyuri(user.email, 'manfra.io', secret)

    const result = await db.update(usersTable).set({ '2faSecret': secret, '2faEnable': true }).where(eq(usersTable.id, id))
    console.log(result)
    const qrCode = await QRCode.toBuffer(uri)

    res.setHeader('Content-Disposition', 'attachment; filename=qrcode.png')
    res.status(200).type('image/png').send(qrCode)
  },
  {
    middleware: authMiddleware,
  }
)

route.post(
  '/api/auth/2fa/validate',
  async ({ req, res, body: { totp } }) => {
    try {
      const id = req.userId
      if (!id) {
        res.status(422).json({ message: 'Please provide the user id' })
        return
      }

      const users = await db.select().from(usersTable).where(eq(usersTable.id, id))
      if (users.length !== 1) {
        res.status(401).json({ message: 'User not found' })
        return
      }
      const user = users[0]

      const secret = user['2faSecret']
      if (!secret) {
        res.status(401).json({ message: '2FA secret is not set for this user' })
        return
      }

      const verified = authenticator.check(totp, secret)

      if (!verified) {
        res.status(400).json({ message: 'TOTP is not correct or expired' })
        return
      }

      await db.update(usersTable).set({ '2faEnable': true }).where(eq(usersTable.id, id))

      res.status(200).json({ message: 'TOTP validated successfully' })
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ message: error.message })
        return
      }
      res.status(500).json({ message: 'Internal Server Error' })
    }
  },
  {
    middleware: authMiddleware,
    body: Type.Object({
      totp: Type.String(),
    }),
  }
)

app.router(route).listen(config.get('port'))

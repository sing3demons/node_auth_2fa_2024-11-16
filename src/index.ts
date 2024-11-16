import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { usersTable } from './db/schema'
import express, { NextFunction, Request, Response } from 'express'
import config from './config'
import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { db } from './db'
import bcrypt from 'bcrypt'
import { cache, connRedis } from './db/redis'
import jwt from 'jsonwebtoken'
import { authenticator } from 'otplib'
import crypto from 'crypto'
import QRCode from 'qrcode'

type User = {
  password: string
  name: string
  email: string
}

const registerSchema = Type.Object({
  name: Type.String(),
  email: Type.String(),
  password: Type.String(),
})

const loginSchema = Type.Object({
  email: Type.String(),
  password: Type.String(),
})

// const main = async () => {}
connRedis()

const app = express()
app.use(express.json())

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    res.status(401).json({ message: 'Access token is required' })
    return
  }

  jwt.verify(token, config.get('accessTokenSecret'), (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' })
    }
    const u = user as { id: number; email: string }
    req.userId = u.id
    next()
  })
  res.status(403).json({ message: 'Invalid token' })
  return
}

app.post(
  '/api/auth/register',
  async (req: Request<{}, User>, res: Response) => {
    const { name, email, password } = req.body
    const result = TypeCompiler.Compile(registerSchema)
    if (!result.Check(req.body)) {
      const value = [...result.Errors(req.body)].map(({ path, message }) => ({
        path,
        message,
      }))

      res.status(422).json(value)
      return
    }

    const checkUser = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))

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
  }
)

app.post(
  '/api/auth/login',
  async (req: Request<{}, Omit<User, 'name'>>, res: Response) => {
    const { email, password } = req.body
    const result = TypeCompiler.Compile(loginSchema)
    if (!result.Check(req.body)) {
      const value = [...result.Errors(req.body)].map(({ path, message }) => ({
        path,
        message,
      }))

      res.status(422).json(value)
      return
    }

    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))

    if (users.length !== 1) {
      res.status(401).json({ message: 'Email or password is invalid' })
      return
    }

    const user = users[0]
    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      res.status(401).json({ message: 'Email or password is invalid' })
      return
    }

    if (user['2faEnable']) {
      const tempToken = crypto.randomUUID()
      const key = `${config.get('cacheTemporaryTokenPrefix')}${tempToken}`
      const exp = config.get('cacheTemporaryTokenExpiresInSeconds')

      const r = await cache.set(key, user.id, { EX: exp })
      console.log('redis set', r)

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

    const key_refreshToken = `refreshToken:${refreshToken}`

    // convert 7day to seconds
    await cache.set(key_refreshToken, 'ok', { EX: 604800 })

    res.status(200).json({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
  }
)

app.post('/api/auth/login/2fa', async (req: Request, res: Response) => {
  try {
    const { tempToken, totp } = req.body

    if (!tempToken || !totp) {
      res
        .status(422)
        .json({ message: 'Please fill in all fields (tempToken and totp)' })
      return
    }
    const key = `${config.get('cacheTemporaryTokenPrefix')}${tempToken}`
    const userId = await cache.get(key)

    if (!userId) {
      res.status(401).json({
        message: 'The provided temporary token is incorrect or expired',
      })
      return
    }

    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, +userId))

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
      res
        .status(401)
        .json({ message: 'The provided TOTP is incorrect or expired' })
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
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({ message: error.message })
      return
    }
    res.status(500).json({ message: 'Internal Server Error' })
  }
})

app.get(
  '/api/auth/2fa/generate',
  authMiddleware,
  async (req: Request, res: Response) => {
    const id = req.userId
    if (!id) {
      res.status(422).json({ message: 'Please provide the user id' })
      return
    }

    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, +id))

    if (users.length !== 1) {
      res.status(401).json({ message: 'Email or password is invalid' })
      return
    }

    const user = users[0]

    const secret = authenticator.generateSecret()
    const uri = authenticator.keyuri(user.email, 'manfra.io', secret)

    const result = await db
      .update(usersTable)
      .set({ '2faSecret': secret, '2faEnable': true })
      .where(eq(usersTable.id, +id))
    console.log(result)
    const qrCode = await QRCode.toBuffer(uri)

    res.setHeader('Content-Disposition', 'attachment; filename=qrcode.png')
    res.status(200).type('image/png').send(qrCode)
  }
)

app.post(
  '/api/auth/2fa/validate',
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const id = req.userId
      const { totp } = req.body

      if (!totp || !id) {
        res.status(422).json({ message: 'TOTP is required' })
        return
      }

      const users = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, +id))
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

      await db
        .update(usersTable)
        .set({ '2faEnable': true })
        .where(eq(usersTable.id, +id))

      res.status(200).json({ message: 'TOTP validated successfully' })
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ message: error.message })
        return
      }
      res.status(500).json({ message: 'Internal Server Error' })
    }
  }
)

app.listen(config.get('port'), () => {
  console.log(`Server is running on port ${config.get('port')}`)
})

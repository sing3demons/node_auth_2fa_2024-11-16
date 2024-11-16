import * as express from 'express'

declare global {
  namespace Express {
    interface Request {
      span_id?: string
      session?: string | null
      userId?: number
    }
  }
}

import * as express from 'express'
import { DetailLog, SummaryLog } from './lib/logger'

declare global {
  namespace Express {
    interface Request {
      span_id?: string
      session?: string | null
      userId?: string
      detailLog: DetailLog
      summaryLog: SummaryLog
    }
  }
}

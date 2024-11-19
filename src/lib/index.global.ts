// import * as express from 'express'
import { DetailLog, SummaryLog } from './logger'

declare global {
  namespace Express {
    interface Request {
      span_id?: string
      session: string 
      invoke: string
      userId?: string
      detailLog: DetailLog
      summaryLog: SummaryLog
    }
  }
}

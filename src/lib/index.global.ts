// import * as express from 'express'

import DetailLog from './logger/detail.js'
import SummaryLog from './logger/summary.js'

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

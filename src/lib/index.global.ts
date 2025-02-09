// import * as express from 'express'

import DetailLog from './logger/detail'
import SummaryLog from './logger/summary'

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

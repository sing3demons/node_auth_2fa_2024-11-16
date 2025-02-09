import dayjs from 'dayjs'
import { confLog, LogConfig } from '../utils/index'
import { writeLogFile } from './logger'
import os from 'os'

type SummaryResult = { resultCode: string; resultDesc: string; count?: number }

interface BlockDetail {
  node: string
  cmd: string
  result: SummaryResult[]
  count: number
}

interface OptionalFields {
  [key: string]: any
}

export default class SummaryLog {
  private requestTime: Date | null = new Date()
  private session: string
  private initInvoke: string
  private cmd: string
  private blockDetail: BlockDetail[] = []
  private optionalField: OptionalFields | undefined

  private conf: LogConfig = {
    detail: confLog.detail,
    projectName: confLog.projectName,
    namespace: confLog.namespace,
    summary: confLog.summary,
  }

  constructor(session: string, initInvoke?: string, cmd?: string) {
    this.session = session
    this.initInvoke = initInvoke || this.conf.projectName + `_${dayjs(new Date()).format('yyyymmddHHMMss')}`
    this.cmd = cmd || ''
  }

  New(scenario: string) {
    this.cmd = scenario
    this.blockDetail.length = 0
    return this
  }

  addField(fieldName: string, fieldValue: any): void {
    if (!this.optionalField) {
      this.optionalField = {}
    }
    this.optionalField[fieldName] = fieldValue
  }

  addSuccessBlock(node: string, cmd: string, resultCode: string, resultDesc: string): void {
    this.addBlock(this.blockDetail, node, cmd, resultCode, resultDesc)
  }

  addErrorBlock(node: string, cmd: string, resultCode: string, resultDesc: string): void {
    this.addBlock(this.blockDetail, node, cmd, resultCode, resultDesc)
  }

  endASync(responseResult: string, responseDesc: string, transactionResult: string, transactionDesc: string): void {
    if (this.isEnd()) {
      throw new Error('summaryLog is ended')
    } else {
      this._process(responseResult, responseDesc, transactionResult, transactionDesc)
    }
  }

  isEnd(): boolean {
    return this.requestTime === null
  }

  end(resultCode: string, resultDescription: string): void {
    if (this.isEnd()) {
      throw new Error('summaryLog is ended')
    } else {
      this._process(resultCode, resultDescription)
    }
  }

  private addBlock(store: BlockDetail[], node: string, cmd: string, resultCode: string, resultDesc: string): void {
    var found = null

    for (var i = 0; i < store.length; i++) {
      if (store[i] !== undefined && store[i]?.node === node && store[i]?.cmd === cmd) {
        found = store[i]
        if (found?.count) {
          found.count++
        }

        break
      }
    }

    if (!found) {
      const result = {
        resultCode: resultCode,
        resultDesc: resultDesc,
        count: 1,
      }

      const b = {
        node: node,
        cmd: cmd,
        count: 1,
        result: [result],
      }
      store.push(b)
    } else {
      const result = {
        resultCode: resultCode,
        resultDesc: resultDesc,
      }
      found.result.push(result)
    }
  }

  private _process(responseResult: string, responseDesc: string, transactionResult?: string, transactionDesc?: string): void {
    const endTime = new Date()
    const seq: any[] = []
    for (let j = 0; j < this.blockDetail.length; j++) {
      const i = this.blockDetail[j]
      if (i) {
        const r = []
        for (var k = 0; k < i.result.length; k++) {
          r.push({
            Result: i.result[k]?.resultCode || 'null',
            Desc: i.result[k]?.resultDesc,
          })
        }
        seq.push({
          Node: i.node,
          Cmd: i.cmd,
          Result: r,
        })
      }
    }

    const o = {
      LogType: 'Summary',
      InputTimeStamp: dayjs(this.requestTime!).format(),
      Host: os.hostname(),
      AppName: this.conf.projectName,
      Instance: process.env.pm_id,
      Session: this.session,
      InitInvoke: this.initInvoke,
      Scenario: this.cmd,
      ResponseResult: responseResult,
      ResponseDesc: responseDesc,
      TransactionResult: transactionResult,
      TransactionDesc: transactionDesc,
      Sequences: seq,
      EndProcessTimeStamp: dayjs(endTime).format(),
      ProcessTime: `${endTime.getTime() - this.requestTime!.getTime()} ms`,
      CustomDesc: this.optionalField ? { ...this.optionalField } : undefined,
    }

    if (this.optionalField) {
      o.CustomDesc = this.optionalField
    }

    if (this.conf.summary.console) {
      process.stdout.write(JSON.stringify(o) + os.EOL)
    }

    writeLogFile('smr', JSON.stringify(o))

    this.requestTime = null // Flag to check end() twice
  }
}

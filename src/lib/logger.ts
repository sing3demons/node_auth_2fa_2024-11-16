import * as os from 'os'
import * as dateFormat from 'dateformat'
import { RotatingFileStream } from 'rotating-file-stream'
import fs from 'fs'
import { Request } from 'express'
import { confLog, createStreams, LogConfig } from './utils/index.js'
import dayjs from 'dayjs'

const endOfLine = os.EOL
const dateFMT = 'yyyy-mm-dd HH:MM:ss'

const streamTask: {
  dtl: RotatingFileStream | null
  smr: RotatingFileStream | null
} = {
  dtl: null,
  smr: null,
}

if (confLog.detail.file) {
  if (!fs.existsSync(confLog.detail.path)) {
    fs.mkdirSync(confLog.detail.path, { recursive: true })
  }

  streamTask.dtl = createStreams('dtl')
}

if (confLog.summary.file) {
  if (!fs.existsSync(confLog.summary.path)) {
    fs.mkdirSync(confLog.summary.path, { recursive: true })
  }

  streamTask.smr = createStreams('smr')
}

function write(type: 'smr' | 'dtl', log: string) {
  if (typeof log !== 'string') {
    streamTask[type]?.write(JSON.stringify(log) + endOfLine)
  } else {
    streamTask[type]?.write(log + endOfLine)
  }
}
interface LogData {
  [key: string]: any
}

interface InputOutput {
  Invoke: string
  Event: string
  Protocol?: string
  Type: string
  RawData?: any
  Data?: any
  ResTime?: string
}

type IDetailLog = {
  LogType: string
  Host: string
  AppName: string
  Instance: number
  Session: string
  InitInvoke: string
  Scenario: string | null
  InputTimeStamp: string | null
  Input: InputOutput[]
  OutputTimeStamp: string | null
  Output: InputOutput[]
  ProcessingTime: string | null
}

class DetailLog {
  public startTimeDate: Date | null = null
  private inputTime: Date | null = null
  private outputTime: Date | null = null
  private timeCounter: { [key: string]: Date } = {}
  public detailLog: IDetailLog
  private conf: LogConfig = confLog

  constructor(session: string, initInvoke?: string, scenario?: string, identity?: string) {
    this.detailLog = {
      LogType: 'Detail',
      Host: os.hostname(),
      AppName: this.conf.projectName,
      Instance: process.pid,
      Session: session,
      InitInvoke: initInvoke || this.conf.projectName + `_${dayjs(new Date(), 'yyyymmddHHMMss')}`,
      Scenario: scenario || '',
      InputTimeStamp: null,
      Input: [],
      OutputTimeStamp: null,
      Output: [],
      ProcessingTime: null,
    }
  }

  public New(scenario: string) {
    this.detailLog.Input.length = 0
    this.detailLog.Scenario = scenario
    return this
  }

  isRawDataEnabled(): boolean {
    return this.conf.detail.rawData === true
  }

  addInputRequest(node: string, cmd: string, invoke: string, req: Request): void {
    const data = {
      headers: req.headers,
      params: req.params,
      query: req.query,
      body: req.body,
    }
    if (invoke === '') {
      invoke = this.detailLog.InitInvoke
    }

    this.addInput(node, cmd, invoke, 'req', '', data, undefined, req.protocol, req.method)
  }

  addInputResponseError(node: string, cmd: string, invoke: string, rawData?: string): void {
    this.addInput(node, cmd, invoke, 'res_error', rawData)
  }

  addInputResponse(node: string, cmd: string, invoke: string, rawData: string, data: LogData, resTime?: number): void {
    this.addInput(node, cmd, invoke, 'res', rawData, data, resTime)
  }

  private addInput(
    node: string,
    cmd: string,
    invoke: string,
    type: string,
    rawData?: string,
    data?: LogData,
    resTime?: number | string,
    protocol?: string,
    protocolMethod?: string
  ): void {
    this.inputTime = new Date()

    if (!this.startTimeDate) {
      this.startTimeDate = this.inputTime
    }

    if (typeof resTime === 'number') {
      resTime = resTime + ' ms'
      delete this.timeCounter[invoke]
    } else if (type.startsWith('res')) {
      if (this.timeCounter[invoke]) {
        resTime = this.inputTime!.getTime() - this.timeCounter[invoke]!.getTime()
        resTime = resTime + ' ms'
        delete this.timeCounter[invoke]
      }
    }

    const input: InputOutput = {
      Invoke: invoke,
      Event: `${node}.${cmd}`,
      Protocol: type === 'req' ? this._buildValueProtocol(protocol, protocolMethod) : undefined,
      Type: type,
      RawData: this.conf.detail.rawData === true ? rawData : undefined,
      Data: data,
      ResTime: resTime,
    }

    this.detailLog.Input.push(input)
  }

  addOutputRequest(
    node: string,
    cmd: string,
    invoke: string,
    rawData: string,
    data: LogData,
    protocol?: string,
    protocolMethod?: string
  ) {
    this.addOutput(node, cmd, invoke, 'req', rawData, data, protocol, protocolMethod)
    return this
  }

  addOutputResponse(node: string, cmd: string, invoke: string, rawData: string, data: LogData) {
    this.addOutput(node, cmd, invoke, 'res', rawData, data)
    return this
  }

  addOutputRequestRetry(
    node: string,
    cmd: string,
    invoke: string,
    rawData: string,
    data: LogData,
    total: number,
    maxCount: number
  ): void {
    this.addOutput(node, cmd, invoke, `req_retry_${total}/${maxCount}`, rawData, data)
  }

  private addOutput(
    node: string,
    cmd: string,
    invoke: string,
    type: string,
    rawData: string,
    data: LogData,
    protocol?: string,
    protocolMethod?: string
  ): void {
    this.outputTime = new Date()

    if (invoke && type !== 'res') {
      this.timeCounter[invoke] = this.outputTime
    }

    const output: InputOutput = {
      Invoke: invoke,
      Event: `${node}.${cmd}`,
      Protocol: type === 'req' ? this._buildValueProtocol(protocol, protocolMethod) : undefined,
      Type: type,
      RawData: this.conf.detail.rawData === true ? rawData : undefined,
      Data: data,
    }

    this.detailLog.Output.push(output)
  }

  end(): void {
    if (!this.startTimeDate) throw new Error('detailLog call "end()", twice')

    const usingDateFMT = 'yyyy-mm-dd HH:MM:ss'
    this.detailLog.ProcessingTime = new Date().getTime() - this.startTimeDate.getTime() + ' ms'
    this.detailLog.InputTimeStamp = this.inputTime && dayjs(this.inputTime, usingDateFMT).toString()

    if (this.outputTime) {
      this.detailLog.OutputTimeStamp = dayjs(this.outputTime, usingDateFMT).toString()
    } else {
      this.detailLog.Output.length = 0
      this.detailLog.OutputTimeStamp = null
    }

    // Writing the log (simulating)
    const log = {
      systemTimestamp: this.detailLog.InputTimeStamp,
      logType: 'Detail',
      logLevel: 'INFO',
      namespace: this.conf.namespace,
      containerId: os.hostname(),
      applicationName: this.detailLog.AppName,
      detail: this.detailLog,
    }

    if (this.conf.detail.console) {
      process.stdout.write(JSON.stringify(log) + endOfLine)
    }

    if (this.conf.detail.file) {
      write('dtl', JSON.stringify(log))
    }
    this._clr()
  }

  private _clr(): void {
    this.detailLog.ProcessingTime = null
    this.detailLog.InputTimeStamp = null
    this.detailLog.OutputTimeStamp = null
    this.detailLog.Input = []
    this.detailLog.Output = []
    this.outputTime = null
    this.startTimeDate = null
  }

  private _buildValueProtocol(protocol: string | undefined, protocolMethod: string | undefined): string | undefined {
    let v = undefined
    if (protocol) {
      v = protocol.toLowerCase()
      if (protocolMethod) {
        v = `${v}.${protocolMethod.toLowerCase()}`
      }
    }
    return v
  }
}

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

class SummaryLog {
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
    this.initInvoke = initInvoke || this.conf.projectName + `_${dayjs(new Date(), 'yyyymmddHHMMss')}`
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
      InputTimeStamp: dayjs(this.requestTime!, dateFMT),
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
      EndProcessTimeStamp: dayjs(endTime, dateFMT),
      ProcessTime: `${endTime.getTime() - this.requestTime!.getTime()} ms`,
      CustomDesc: this.optionalField ? { ...this.optionalField } : undefined,
    }

    if (this.optionalField) {
      o.CustomDesc = this.optionalField
    }

    if (this.conf.summary.console) {
      process.stdout.write(JSON.stringify(o) + endOfLine)
    }

    if (this.conf.summary.file) {
      write('smr', JSON.stringify(o))
    }

    this.requestTime = null // Flag to check end() twice
  }
}

export { SummaryLog, DetailLog }

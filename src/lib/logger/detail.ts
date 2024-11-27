import * as os from 'os'
import { Request } from 'express'
import { confLog, LogConfig } from '../utils/index.js'
import dayjs from 'dayjs'
import { writeLogFile } from './logger.js'

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

interface MaskingConfig {
  highlight?: string[]
  mark?: string[]
}

export default class DetailLog {
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
      InitInvoke: initInvoke || this.conf.projectName + `_${dayjs().format('yyyymmddHHMMss')}`,
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
  private maskingConfig: MaskingConfig = {
    highlight: ['email', 'phone'],
    mark: ['password', 'pin', 'otp', 'token', 'secret', 'api-key'],
  }

  private maskSensitiveData<T>(body: T): T {
    if (!body) {
      return body
    } else if (typeof body === 'string') {
      try {
        const parsedBody = JSON.parse(body)
        const data = JSON.stringify(this.maskSensitiveData(parsedBody))
        return data as T
      } catch (error) {
        return body
      }
    } else if (typeof body === 'object') {
      const data = JSON.parse(JSON.stringify(body)) // Clone the object to avoid modifying the original data
      const maskedData: any = Array.isArray(data) ? [] : {}

      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          // Check if the key is in 'mark' (full mask) or 'highlight' (partial mask)
          if (this.maskingConfig?.mark?.includes(key)) {
            maskedData[key] = '******' // Fully mask fields in 'mark'
          } else if (this.maskingConfig?.highlight?.includes(key)) {
            maskedData[key] = this.applyPartialMask(data[key]) // Partially mask fields in 'highlight'
          } else if (typeof data[key] === 'object') {
            // Recursively mask nested objects
            maskedData[key] = this.maskSensitiveData(data[key])
          } else {
            maskedData[key] = data[key]
          }
        }
      }

      return maskedData
    } else {
      return body
    }
  }
  private applyPartialMask(value: string): string {
    const rex = new RegExp(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/)
    if (rex.test(value)) {
      let [first, second] = value.split('@')
      if (!first) {
        return ''
      }
      if (first.length > 2) {
        const mask = first.substring(3, first.length)
        const notMask = first.substring(0, 3)
        first = notMask + '*'.repeat(mask.length)
      } else {
        first = first.replace(first.substring(1, first.length), '*'.repeat(first.length - 1))
      }
      return `${first}@${second}`
    }

    return value.length > 2 ? value.substring(0, 2) + '*'.repeat(value.length - 2) : value
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

    if (rawData) {
      rawData = this.maskSensitiveData(rawData)
    }

    if (data) {
      data = this.maskSensitiveData(data)
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

    if (rawData) {
      rawData = this.maskSensitiveData(rawData)
    }

    if (data) {
      data = this.maskSensitiveData(data)
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

  public isEnd(): boolean {
    return this.startTimeDate === null
  }

  end(): void {
    if (!this.startTimeDate) throw new Error('detailLog call "end()", twice')

    const usingDateFMT = 'yyyy-mm-dd HH:MM:ss'
    this.detailLog.ProcessingTime = new Date().getTime() - this.startTimeDate.getTime() + ' ms'
    this.detailLog.InputTimeStamp = this.inputTime && dayjs(this.inputTime).format()

    if (this.outputTime) {
      this.detailLog.OutputTimeStamp = dayjs(this.outputTime).format()
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
      process.stdout.write(JSON.stringify(log) + os.EOL)
    }

    writeLogFile('dtl', JSON.stringify(log))
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

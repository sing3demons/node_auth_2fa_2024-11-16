import * as os from 'os'
import { RotatingFileStream } from 'rotating-file-stream'
import fs from 'fs'
import { confLog, createStreams, LogConfig } from '../utils/index.js'

const endOfLine = os.EOL

// const streamTask: { dtl: RotatingFileStream | null; smr: RotatingFileStream | null } = { dtl: null, smr: null }
const streamTask = new Map<string, RotatingFileStream>()

if (confLog.detail.file) {
  if (!fs.existsSync(confLog.detail.path)) {
    fs.mkdirSync(confLog.detail.path, { recursive: true })
  }

  streamTask.set('dtl', createStreams('dtl'))
}

if (confLog.summary.file) {
  if (!fs.existsSync(confLog.summary.path)) {
    fs.mkdirSync(confLog.summary.path, { recursive: true })
  }

  // streamTask.smr = createStreams('smr')
  streamTask.set('smr', createStreams('smr'))
}

const conf: LogConfig = {
  detail: confLog.detail,
  projectName: confLog.projectName,
  namespace: confLog.namespace,
  summary: confLog.summary,
}

function writeLogFile(type: 'smr' | 'dtl', log: string) {
  if (conf.detail.file && log) {
    streamTask.get(type)?.write(log + endOfLine)
  }
  if (conf.summary.file && log) {
    streamTask.get(type)?.write(log + endOfLine)
  }
}

export { writeLogFile }

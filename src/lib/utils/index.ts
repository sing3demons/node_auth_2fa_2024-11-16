import randomString from 'randomstring'
import { createStream } from 'rotating-file-stream'
import * as os from 'os'
import dayjs from 'dayjs'
const dateFMT = 'yyyy-mm-dd HH:MM:ss'

interface ConfigLog {
  format: 'json'
  time: number
  size?: number
  path: string
  console: boolean
  file: boolean
  rawData?: boolean
}

interface LogConfig {
  summary: ConfigLog
  projectName: string
  namespace: string
  detail: ConfigLog
}

const confLog: LogConfig = {
  detail: {
    rawData: true,
    path: './logs/detail/',
    format: 'json',
    time: 15,
    console: false,
    file: true,
  },
  projectName: 'my-project',
  namespace: 'default',
  summary: {
    format: 'json',
    time: 15,
    path: './logs/summary/',
    console: false,
    file: true,
  },
}

if (process.env.CONFIG_LOG) {
  const configLog = JSON.parse(process.env.CONFIG_LOG)

  const updateConfig = (target: ConfigLog, source: Partial<ConfigLog>) => {
    Object.assign(target, source)
  }

  if (configLog.projectName) {
    confLog.projectName = configLog.projectName
  }
  if (configLog.namespace) {
    confLog.namespace = configLog.namespace
  }
  if (configLog.summary) {
    updateConfig(confLog.summary, configLog.summary)
  }
  if (configLog.detail) {
    updateConfig(confLog.detail, configLog.detail)
  }
}

function generateXTid(nodeName: string = '') {
  const now = new Date()
  const date = dayjs(now, 'yymmdd')
  let xTid = nodeName.substring(0, 5) + '-' + date
  const remainingLength = 22 - xTid.length
  xTid += randomString.generate(remainingLength)
  return xTid
}

function getFileName(type: 'smr' | 'dtl', date?: Date | undefined, index?: number | undefined): string {
  const hostname = os.hostname()
  const projectName = confLog.projectName
  const pmId = process.pid

  const formattedDate = date ? `_${dayjs(date, dateFMT)}` : `_${dayjs(new Date(), dateFMT)}`
  const formattedIndex = index ? `.${index}` : ''
  if (type === 'smr') {
    return `/${hostname}_${projectName}${formattedDate}${formattedIndex}.${pmId}.sum.log`
  }

  return `/${hostname}_${projectName}${formattedDate}${formattedIndex}.${pmId}.detail.log`
}

function createStreams(type: 'smr' | 'dtl') {
  const stream = createStream(getFileName(type), {
    size: '10M', // rotate every 10 MegaBytes written
    interval: '1d', // rotate daily
    compress: 'gzip', // compress rotated files
    path: type === 'smr' ? confLog.summary.path : confLog.detail.path,
  })

  stream.on('error', (err) => {
    console.error(err)
  })

  stream.on('warning', (err) => {
    console.error(err)
  })

  return stream
}

export {  randomString, generateXTid, getFileName, createStreams, confLog, LogConfig }

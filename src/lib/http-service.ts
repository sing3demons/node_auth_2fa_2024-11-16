import axios, { AxiosBasicCredentials, AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import axiosRetry from 'axios-retry'
import { DetailLog, SummaryLog } from './logger'

type TMap = {
  [key: string]: string
}

type RequestAttributes = {
  headers: TMap
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  params?: TMap
  query?: TMap
  body?: TMap
  retry_condition?: string
  retry_count?: number
  timeout?: number
  _service: string
  _command: string
  _invoke: string
  url: string
  auth?: AxiosBasicCredentials
  statusSuccess?: number[]
}

type ApiResponse = {
  Header: any
  Body: any
  Status: number
  StatusText?: string
}

type RA = RequestAttributes | RequestAttributes[]
type ReturnPromise<T> = T extends RequestAttributes[] ? ApiResponse[] : ApiResponse

async function requestHttp<T extends RA>(
  optionAttributes: T,
  detailLog?: DetailLog,
  summaryLog?: SummaryLog,
  defaultStatusSuccess: boolean = true
): Promise<ReturnPromise<T>> {
  const requests: Promise<AxiosResponse<ApiResponse, ApiResponse>>[] = []
  const requestAttributes = []
  const statusSuccess = new Set<number>()
  if (defaultStatusSuccess) {
    statusSuccess.add(200).add(201)
  }
  axiosRetry(axios, {
    retries: 10,
    retryDelay: (retryCount, error) => {
      if (error.response) {
        const retry_after = error.response.headers['retry-after']
        if (retry_after) {
          console.log('retry_after', retry_after)
          return retry_after * 1000
        }
      }

      return axiosRetry.exponentialDelay(retryCount)
    },
    retryCondition: (error) => {
      return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429
    },
  })

  if (Array.isArray(optionAttributes)) {
    optionAttributes.forEach((attr) => {
      if (attr.statusSuccess) {
        attr.statusSuccess.forEach((status) => {
          statusSuccess.add(status)
        })
      }
      requestAttributes.push(attr)
    })
  } else {
    if (optionAttributes.statusSuccess) {
      optionAttributes.statusSuccess.forEach((status) => {
        statusSuccess.add(status)
      })
    }
    requestAttributes.push(optionAttributes)
  }

  const ins = new InstanceHTTPReq(requestAttributes.length)

  function processOptionAttr(attr: RequestAttributes): void {
    const { _service, _command, _invoke, method, url, query, body, params, headers, auth, timeout } = attr

    const options: AxiosRequestConfig = {
      method,
      url: params ? replaceUrlParam(url, params) : url,
      auth,
      params: query,
      data: body,
      headers,
      timeout: timeout ? timeout * 1000 : undefined,
    }

    const processLog = {
      Header: options.headers,
      Url: options.url,
      QueryString: options.params,
      Body: options.data,
    }
    const rawData = JSON.stringify(processLog)

    detailLog?.addOutputRequest(_service, _command, _invoke, rawData, processLog, 'http')
    requests.push(
      axios
        .request(options)
        .then((response) => {
          const responseLog: ApiResponse = {
            Header: response.headers,
            Body: response.data,
            Status: response.status,
            StatusText: response.statusText,
          }

          detailLog?.addInputResponse(_service, _command, _invoke, JSON.stringify(responseLog), responseLog)
          ins.recvRes()
          return response
        })
        .catch((error) => {
          let _error = 'error occurred',
            result_code = 'null'

          if (error instanceof AxiosError) {
            if (error.code === 'ECONNABORTED') {
              result_code = 'ret=4'
              _error = 'timeout'
            } else if (['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH'].includes(error.code || '')) {
              result_code = 'ret=1'
              _error = 'connection error'
            } else {
              if (error.message) {
                _error = error.message
              }
            }
          } else {
            if (error.message) {
              _error = error.message
            }
          }

          detailLog?.addInputResponseError(_service, _command, _invoke)
          summaryLog?.addErrorBlock(_service, _command, result_code, _error)
          ins.recvRes()
          return error
        })
    )
  }

  requestAttributes.forEach(processOptionAttr)

  flushDetailLog(ins, detailLog)

  if (requests.length === 1) {
    const body = await requests[0]
    const response: ApiResponse = {
      Body: body.data,
      Header: body.headers,
      Status: body.status,
      StatusText: body.statusText,
    }
    return response as T extends RequestAttributes[] ? ApiResponse[] : ApiResponse
  }

  const result = await Promise.allSettled(requests)
  const response: ApiResponse[] = []
  result.forEach((res) => {
    if (res.status === 'fulfilled') {
      if (statusSuccess.size > 1 && statusSuccess.has(res.value.status)) {
        const { status, headers, data, statusText } = res.value as unknown as AxiosResponse
        const responseLog: ApiResponse = {
          Header: headers,
          Body: data,
          Status: status,
          StatusText: statusText,
        }
        response.push(responseLog)
      } else if (statusSuccess.size === 0) {
        const { status, headers, data, statusText } = res.value as unknown as AxiosResponse
        const responseLog: ApiResponse = {
          Header: headers,
          Body: data,
          Status: status,
          StatusText: statusText,
        }
        response.push(responseLog)
      }
    }
  })
  result.length = 0
  statusSuccess.clear()
  return response as T extends RequestAttributes[] ? ApiResponse[] : ApiResponse
}

class InstanceHTTPReq {
  totalResCount = 0
  constructor(private reqCount: number) {
    this.reqCount = reqCount
  }

  recvRes() {
    this.totalResCount++
  }

  isCompleted() {
    return this.totalResCount >= this.reqCount
  }
}

function flushDetailLog(ins: InstanceHTTPReq, detailLog?: DetailLog) {
  if (!ins.isCompleted()) {
    try {
      detailLog?.end()
    } catch (e) {
      console.error(e)
    }
  }
}

function replaceUrlParam(url: string, params?: TMap) {
  let subURL = url.split('/')
  if (!params) return url
  for (var i = 0; i < subURL.length; i++) {
    if (subURL[i] !== '' && subURL[i].startsWith(':')) {
      let replaceValue = params[subURL[i].substring(1)]
      if (replaceValue) {
        subURL[i] = replaceValue
        continue
      }
    }
  }
  return subURL.join('/')
}

export { requestHttp, RequestAttributes }

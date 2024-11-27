import { Static, TSchema, Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import express, { type Request, type Response, type NextFunction, type RequestHandler, Router, type Express } from 'express'
import { v7 as uuid } from 'uuid'
import http from 'http'
import { Socket } from 'net'
import NODE_NAME from './constants/modeName.js'
import { generateXTid } from './utils/index.js'
import DetailLog from './logger/detail.js'
import SummaryLog from './logger/summary.js'

type ExtractParams<T extends string> = T extends `${infer _Start}:${infer Param}/${infer Rest}`
  ? [Param, ...ExtractParams<Rest>]
  : T extends `${infer _Start}:${infer Param}`
  ? [Param]
  : []

type TP<T extends string> = {
  [K in T[number]]: string
}

type ExtractParamsFromPath<T extends string[]> = { [K in T[number]]: string }
type U = unknown
type MaybePromise = Promise<U> | U
type TParam<T extends string> = ExtractParamsFromPath<ExtractParams<T>>
type TS = TSchema
type RouteHandler<T extends string, P = TParam<T>, B = U, Q = U> = (ctx: ICtx<P, B, Q>) => MaybePromise

type ICtx<P, B, Q> = {
  params: P
  body: B
  query: Q
  req: Request
  res: Response
  next: NextFunction
}

enum HttpMethod {
  GET = 'get',
  POST = 'post',
  PUT = 'put',
  PATCH = 'patch',
  DELETE = 'delete',
}

type TSchemas = {
  params?: TS
  body?: TS
  query?: TS
  middleware?: RequestHandler
}

interface Route<T extends string = string, B extends TS = any, Q extends TS = any> {
  path: T
  method: HttpMethod
  handler: RouteHandler<T, B, Q>
  schemas?: TSchemas
}

type RouteSchema<P, B, Q> = {
  params?: P
  body?: B
  query?: Q
  cmd?: string
  middleware?: RequestHandler
}

type SchemaT = {
  params?: TS
  body?: TS
  query?: TS
  cmd?: string
}

type StatusDetails = {
  status: number | string
  statusCode: number | string
  code: number | string
}

type THandler<T extends string, B extends TS, Q extends TS> = RouteHandler<T, TParam<T>, Static<B>, Static<Q>>

class BaseRoute {
  protected routes: Route[] = []

  protected addRoute<T extends string, P extends TP<T>, B extends TS, Q extends TS>(
    method: HttpMethod,
    path: T,
    handler: RouteHandler<T, P, Static<B>, Static<Q>>,
    schemas?: RouteSchema<TS, B, Q>
  ) {
    if (!method || !path || typeof handler !== 'function') {
      throw new Error('Invalid route definition')
    }
    this.routes.push({ path, method, handler, schemas })
    return this
  }

  public get<T extends string, P extends TS, B extends TS, Q extends TS>(
    path: T,
    handler: THandler<T, B, Q>,
    schemas?: RouteSchema<P, B, Q>
  ): this {
    return this.addRoute(HttpMethod.GET, path, handler, schemas)
  }

  public post<T extends string, P extends TS, B extends TS, Q extends TS>(
    path: T,
    handler: THandler<T, B, Q>,
    schemas?: RouteSchema<P, B, Q>
  ): this {
    return this.addRoute(HttpMethod.POST, path, handler, schemas)
  }

  public put<T extends string, P extends TS, B extends TS, Q extends TS>(
    path: T,
    handler: THandler<T, B, Q>,
    schemas?: RouteSchema<P, B, Q>
  ): this {
    return this.addRoute(HttpMethod.PUT, path, handler, schemas)
  }

  public patch<T extends string, P extends TS, B extends TS, Q extends TS>(
    path: T,
    handler: THandler<T, B, Q>,
    schemas?: RouteSchema<P, B, Q>
  ): this {
    return this.addRoute(HttpMethod.PATCH, path, handler, schemas)
  }

  public delete<T extends string, P extends TS, B extends TS, Q extends TS>(
    path: T,
    handler: THandler<T, B, Q>,
    schemas?: RouteSchema<P, B, Q>
  ): this {
    return this.addRoute(HttpMethod.DELETE, path, handler, schemas)
  }

  private validateRequest(req: Request, schemas?: SchemaT) {
    if (schemas?.params) {
      const result = TypeCompiler.Compile(schemas.params)
      if (!result.Check(req.params)) {
        const first = result.Errors(req.params).First()
        if (first) {
          throw first
        }
      }
    }
    if (schemas?.body) {
      const result = TypeCompiler.Compile(schemas.body)
      if (!result.Check(req.body)) {
        const first = result.Errors(req.body).First()
        if (first) {
          throw first
        }
      }
    }
    if (schemas?.query) {
      const result = TypeCompiler.Compile(schemas.query)
      if (!result.Check(req.query)) {
        const first = result.Errors(req.query).First()
        if (first) {
          throw first
        }
      }
    }
  }

  private preRequest(handler: RouteHandler<any, any, any>) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = {
          params: req.params,
          body: req.body,
          query: req.query,
          req: req as Request,
          res: res as Response,
          next,
        }

        const result = (await handler(ctx)) as StatusDetails
        if (result) {
          if (result?.status) {
            res.status(+result.status)
          } else if (result?.statusCode) {
            res.status(+result.statusCode)
          } else if (result?.code) {
            res.status(+result.code)
          }
          res.send(result)
        }
      } catch (e) {
        next(e)
      }
    }
  }

  private handleError(error: unknown, req: Request, res: Response) {
    const detailLog = req.detailLog
    const summaryLog = req.summaryLog
    const cmd = detailLog.detailLog?.Input[0]?.Event?.split('.')[1] || ''
    if (error instanceof Object) {
      const err = error as { path: string; message: string }
      if (err.path && err.message) {
        const details = {
          name: err?.path.startsWith('/') ? err.path.replace('/', '') : err.path || 'unknown',
          message: err?.message || 'Unknown error',
        }
        const status = '400'
        const response = {
          success: false,
          message: 'Validation failed',
          details,
        }
        if (!summaryLog.isEnd()) {
          summaryLog.addErrorBlock(NODE_NAME.CLIENT, cmd, status, response.message)

          summaryLog.end(status, 'error')
        }
        if (detailLog.startTimeDate) {
          detailLog.addOutputResponse(NODE_NAME.CLIENT, cmd, '', JSON.stringify(response), response).end()
        }

        res.status(+status).json(response)
      } else {
        const code = error as unknown as { statusCode?: number; status?: number }
        if (detailLog.startTimeDate) {
          detailLog.addOutputResponse(NODE_NAME.CLIENT, cmd, '', '', code).end()
        }
        summaryLog.addField('result_code', code.statusCode || code.status || 500)
        summaryLog.end('500', 'error')
        res.status(code.statusCode || code.status || 500).json(error)
      }
    } else if (error instanceof Error) {
      if (detailLog.startTimeDate) {
        detailLog
          .addOutputResponse(NODE_NAME.CLIENT, cmd, '', '', {
            name: error.name,
            message: error.message,
            stack: error.stack,
          })
          .end()
      }
      // summaryLog.addField('result_code', error.message)
      summaryLog.end('500', 'error')
      // Handle general errors
      res.status(500).json({
        success: false,
        message: error.message,
        traceStack: error.stack,
      })
    } else {
      if (detailLog.startTimeDate) {
        detailLog.addOutputResponse(NODE_NAME.CLIENT, cmd, '', '', { error: String(error) }).end()
      }
      summaryLog.addField('result_code', String(error))
      summaryLog.end('500', 'error')
      // Handle other errors
      res.status(500).json({
        success: false,
        message: 'Unknown error',
        details: error,
      })
    }

    // Proceed to the next middleware
    // return next(error)
  }
  protected createHandler(handler: RouteHandler<any>, schemas?: SchemaT) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const session = req.session
        const invoke = req.invoke
        req.detailLog = new DetailLog(session, invoke)
        req.summaryLog = new SummaryLog(session, invoke)
        const cmd = schemas?.cmd || `${req.method}${req.originalUrl}`.replace(/\//g, '_').replace('__', '_').toLowerCase()

        req.detailLog.addInputRequest(NODE_NAME.CLIENT, cmd, '', req)
        this.validateRequest(req, schemas)
        this.preRequest(handler)(req, res, next)
      } catch (error) {
        this.handleError(error, req, res)
      }
    }
  }
}

class AppRouter extends BaseRoute {
  constructor(private readonly instance: Router = Router()) {
    super()
  }

  private createParamsObject<T extends string>(path: T) {
    const matches = path.match(/:(\w+)/g)
    const paramsArray = matches ? (matches.map((match) => match.substring(1)) as ExtractParams<T>) : []

    const routeParamsSchema = Type.Object(
      paramsArray.reduce((acc, key) => {
        acc[key as keyof typeof acc] = Type.String()
        return acc
      }, {} as Record<(typeof paramsArray)[number], any>)
    )

    return routeParamsSchema
  }

  public register() {
    this.routes.forEach((route) => {
      const { path, handler, schemas, method } = route
      const m = schemas?.middleware ? [schemas.middleware] : []
      const schemaObject = this.createParamsObject(path) as TS
      const schema = schemas ?? {}

      if (Object.keys(schemaObject.properties).length) {
        if (!schema?.params) {
          schema.params = schemaObject as TS
        }
      }

      this.instance.route(path)[method](...m, this.createHandler(handler, schema))
    })

    return this.instance
  }
}

interface IServer {
  router: (router: AppRouter, ...middleware: RequestHandler[]) => IServer
  group: (path: string, router: AppRouter, ...middleware: RequestHandler[]) => IServer
  use: (...handler: RequestHandler[]) => IServer
  listen: (port: number | string, close?: () => Promise<void> | void) => void
}

function globalErrorHandler(error: unknown, _request: Request, res: Response, _next: NextFunction) {
  let statusCode = 500
  let message = 'An unknown error occurred'
  if (error instanceof Error) {
    message = error.message

    if (message.includes('not found')) {
      statusCode = 404
    }
  } else {
    message = `An unknown error occurred, ${String(error)}`
  }

  const data = {
    statusCode: statusCode,
    message,
    success: false,
    data: null,
    traceStack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
  }
  res.status(statusCode).send(data)
}

const transaction = 'x-session-id'

class AppServer implements IServer {
  private readonly app: Express = express()
  constructor(before?: () => void) {
    if (before) {
      before()
    }
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (!req.headers[transaction]) {
        req.headers[transaction] = uuid()
        req.session = req.headers[transaction]
      }

      if (req.headers['x-tid']) {
        req.invoke = req.headers['x-tid'] as string
      } else {
        req.invoke = generateXTid('clnt')
      }

      next()

      const originalSend = res.send
      res.send = (body: any) => {
        if (!req?.detailLog?.isEnd()) {
          req.detailLog
            ?.addOutputResponse(NODE_NAME.CLIENT, req.detailLog.detailLog.Input[0]!.Event.split('.')[1]!, '', '', body)
            .end()
          req.detailLog = null as unknown as DetailLog
        }
        if (!req?.summaryLog?.isEnd()) {
          const result_desc =
            res.statusCode === 200 || res.statusCode === 201
              ? ''
              : res.statusCode === 404
              ? 'not_found'
              : res.statusCode === 400
              ? 'bad_request'
              : res.statusCode === 401
              ? 'unauthorized'
              : res.statusCode === 403
              ? 'forbidden'
              : res.statusCode === 405
              ? 'method_not_allowed'
              : res.statusCode === 409
              ? 'conflict'
              : res.statusCode === 422
              ? 'unprocessable_entity'
              : res.statusCode === 429
              ? 'too_many_requests'
              : res.statusCode === 500
              ? 'internal_server_error'
              : 'unknown'

          if (!!result_desc) {
            req.summaryLog.addField('message', result_desc)
          }

          req?.summaryLog.end(res.statusCode.toString(), result_desc)
        }
        return originalSend.call(res, body)
      }
    })
    this.app.use(express.json())
    this.app.use(express.urlencoded({ extended: true }))
  }

  public group(path: string, router: AppRouter, ...middleware: RequestHandler[]) {
    this.app.use(path, ...middleware, router.register())
    return this
  }

  public router(router: AppRouter, ...middleware: RequestHandler[]) {
    this.app.use(...middleware, router.register())

    return this
  }

  public use(...middleware: RequestHandler[]) {
    this.app.use(...middleware)
    return this
  }

  public listen(port: number | string, close?: () => Promise<void> | void) {
    this.app.use((req: Request, res: Response, _next: NextFunction) => {
      res.status(404).json({ message: 'Unknown URL', path: req.originalUrl })
    })
    this.app.use(globalErrorHandler)

    const server = http.createServer(this.app).listen(port, () => {
      console.log(`Server listening on port ${port}`)
    })

    const connections = new Set<Socket>()

    server.on('connection', (connection) => {
      connections.add(connection)
      connection.on('close', () => {
        connections.delete(connection)
      })
    })

    const signals = ['SIGINT', 'SIGTERM']
    signals.forEach((signal) => {
      process.on(signal, () => {
        console.log(`Received ${signal}. Closing server.`)
        server.close(() => {
          console.log('Server closed.')
          close?.()
          process.exit(0)
        })

        // If after 10 seconds the server hasn't finished, force shutdown
        setTimeout(() => {
          console.log('Could not close server in time. Forcing shutdown.')
          connections.forEach((connection) => {
            connection.destroy()
          })
          close?.()
          process.exit(1)
        }, 10000)
      })
    })
  }
}

export { AppRouter, Type, generateXTid }
export default AppServer

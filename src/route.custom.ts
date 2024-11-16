import { Static, TSchema, Type } from '@sinclair/typebox'
import { TypeCompiler, ValueErrorIterator } from '@sinclair/typebox/compiler'
import {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
  Router,
} from 'express'
import { ValueError } from '@sinclair/typebox/value'

type ExtractParams<T extends string> =
  T extends `${infer _Start}:${infer Param}/${infer Rest}`
    ? [Param, ...ExtractParams<Rest>]
    : T extends `${infer _Start}:${infer Param}`
    ? [Param]
    : []

type ExtractParamsFromPath<T extends string[]> = { [K in T[number]]: string }

type MaybePromise = Promise<unknown> | unknown

type RouteHandler<
  T extends string,
  P = ExtractParamsFromPath<ExtractParams<T>>,
  B = unknown,
  Q = unknown
> = (ctx: {
  params: P
  body: B
  query: Q
  req: Request
  res: Response
  next: NextFunction
}) => MaybePromise

enum HttpMethod {
  GET = 'get',
  POST = 'post',
  PUT = 'put',
  PATCH = 'patch',
  DELETE = 'delete',
}

interface Route<
  T extends string = string,
  P extends TSchema = any,
  B extends TSchema = any,
  Q extends TSchema = any
> {
  path: T
  method: HttpMethod
  handler: RouteHandler<T, B, Q>
  schemas?: {
    params?: TSchema
    body?: TSchema
    query?: TSchema
    middleware?: RequestHandler
  }
}

type RouteSchema<P, B, Q> = {
  params?: P
  body?: B
  query?: Q
  middleware?: RequestHandler
}

type SchemaT = {
  params?: TSchema
  body?: TSchema
  query?: TSchema
}

type THandler<
  T extends string,
  B extends TSchema,
  Q extends TSchema
> = RouteHandler<
  T,
  ExtractParamsFromPath<ExtractParams<T>>,
  Static<B>,
  Static<Q>
>

class BaseRoute {
  protected routes: Route[] = []

  protected addRoute<
    T extends string,
    P extends { [K in T[number]]: string },
    B extends TSchema = TSchema,
    Q extends TSchema = TSchema
  >(
    method: HttpMethod,
    path: T,
    handler: RouteHandler<T, P, Static<B>, Static<Q>>,
    schemas?: RouteSchema<TSchema, B, Q>
  ) {
    if (!method || !path || typeof handler !== 'function') {
      throw new Error('Invalid route definition')
    }
    this.routes.push({ path, method, handler, schemas })
    return this
  }

  public get<
    T extends string,
    P extends TSchema,
    B extends TSchema,
    Q extends TSchema
  >(path: T, handler: THandler<T, B, Q>, schemas?: RouteSchema<P, B, Q>): this {
    return this.addRoute(HttpMethod.GET, path, handler, schemas)
  }

  public post<
    T extends string,
    P extends TSchema,
    B extends TSchema,
    Q extends TSchema
  >(path: T, handler: THandler<T, B, Q>, schemas?: RouteSchema<P, B, Q>): this {
    return this.addRoute(HttpMethod.POST, path, handler, schemas)
  }

  public put<
    T extends string,
    P extends TSchema,
    B extends TSchema,
    Q extends TSchema
  >(path: T, handler: THandler<T, B, Q>, schemas?: RouteSchema<P, B, Q>): this {
    return this.addRoute(HttpMethod.PUT, path, handler, schemas)
  }

  public patch<
    T extends string,
    P extends TSchema,
    B extends TSchema,
    Q extends TSchema
  >(path: T, handler: THandler<T, B, Q>, schemas?: RouteSchema<P, B, Q>): this {
    return this.addRoute(HttpMethod.PATCH, path, handler, schemas)
  }

  public delete<
    T extends string,
    P extends TSchema,
    B extends TSchema,
    Q extends TSchema
  >(path: T, handler: THandler<T, B, Q>, schemas?: RouteSchema<P, B, Q>): this {
    return this.addRoute(HttpMethod.DELETE, path, handler, schemas)
  }

  private validateRequest(req: Request, schemas?: SchemaT) {
    const valueErr = new Map<string, { path: string; message: string[] }>()

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
        const result = await handler(ctx)
      } catch (e) {
        next(e)
      }
    }
  }

  private handleError(error: unknown, res: Response, next: NextFunction) {
    console.log('Error:', typeof error, error)
    if (error instanceof Object) {
      // Assuming `error` is an array of manual validation error messages
      const err = error as { path: string; message: string }
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        details: {
          name: err?.path.startsWith('/')
            ? err.path.replace('/', '')
            : err.path || 'unknown',
          message: err?.message || 'Unknown error',
        },
      })
    } else if (error instanceof Error) {
      // Handle general errors
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        traceStack: error.stack,
      })
    }

    // Proceed to the next middleware
    next(error)
  }
  protected createHandler(handler: RouteHandler<any>, schemas?: SchemaT) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.validateRequest(req, schemas)
        this.preRequest(handler)(req, res, next)
      } catch (error) {
        this.handleError(error, res, next)
      }
    }
  }
}

function createParamsObject<T extends string>(path: T) {
  const matches = path.match(/:(\w+)/g)
  const paramsArray = matches
    ? (matches.map((match) => match.substring(1)) as ExtractParams<T>)
    : []

  const routeParamsSchema = Type.Object(
    paramsArray.reduce((acc, key) => {
      acc[key as keyof typeof acc] = Type.String()
      return acc
    }, {} as Record<(typeof paramsArray)[number], any>)
  )

  return routeParamsSchema
}

class AppRouter extends BaseRoute {
  constructor(private readonly instance: Router = Router()) {
    super()
  }
  public register() {
    this.routes.forEach((route) => {
      const { path, handler, schemas, method } = route
      const m = schemas?.middleware ? [schemas.middleware] : []
      const schemaObject = createParamsObject(path) as TSchema
      const schema = schemas ?? {}

      if (Object.keys(schemaObject.properties).length) {
        if (!schema?.params) {
          schema.params = schemaObject as TSchema
        }
      }

      this.instance
        .route(path)
        [method](...m, this.createHandler(handler, schema))
    })

    return this.instance
  }
}

export { AppRouter, Type }

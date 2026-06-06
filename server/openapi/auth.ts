import type { OpenAPI } from '@orpc/openapi'
import { auth } from '../auth'

type Paths = NonNullable<OpenAPI.Document['paths']>
type Components = NonNullable<OpenAPI.Document['components']>
type PathItem = NonNullable<Paths[string]>
type Operation = OpenAPI.OperationObject
type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'patch' | 'options' | 'head' | 'trace'

const PUBLIC_AUTH_PATHS = new Set([
  '/sign-up/email',
  '/sign-in/email',
  '/get-session',
  '/sign-out'
])

const AUTH_OPERATION_IDS: Record<string, string> = {
  'POST /sign-up/email': 'auth.signUpEmail',
  'POST /sign-in/email': 'auth.signInEmail',
  'GET /get-session': 'auth.getSession',
  'POST /get-session': 'auth.getSessionPost',
  'POST /sign-out': 'auth.signOut'
}

const AUTHENTICATED_OPERATIONS = new Set([
  'GET /get-session',
  'POST /get-session',
  'POST /sign-out'
])

const SCHEMA_REF_RENAMES: Record<string, string> = {
  '#/components/schemas/User': '#/components/schemas/BetterAuthUser',
  '#/components/schemas/Session': '#/components/schemas/BetterAuthSession'
}

function cloneOpenAPIValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function rewriteSchemaRefs<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => rewriteSchemaRefs(item)) as T
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const object = value as Record<string, unknown>
  const rewritten: Record<string, unknown> = {}

  for (const [key, item] of Object.entries(object)) {
    if (key === '$ref' && typeof item === 'string') {
      rewritten[key] = SCHEMA_REF_RENAMES[item] ?? item
      continue
    }

    rewritten[key] = rewriteSchemaRefs(item)
  }

  return rewritten as T
}

function getOperation(pathItem: PathItem, method: HttpMethod): Operation | undefined {
  const operation = (pathItem as Record<HttpMethod, unknown>)[method]

  if (!operation || typeof operation !== 'object' || '$ref' in operation) {
    return undefined
  }

  return operation as Operation
}

function normalizeAuthPathItem(path: string, pathItem: unknown): PathItem {
  const normalized = rewriteSchemaRefs(cloneOpenAPIValue(pathItem)) as PathItem
  const methods: HttpMethod[] = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']

  for (const method of methods) {
    const operation = getOperation(normalized, method)

    if (!operation) {
      continue
    }

    const operationKey = `${method.toUpperCase()} ${path}`

    operation.tags = ['Auth']
    operation.operationId = AUTH_OPERATION_IDS[operationKey] ?? operation.operationId

    if (AUTHENTICATED_OPERATIONS.has(operationKey)) {
      operation.security = [
        { bearerAuth: [] },
        { betterAuthCookie: [] }
      ]
    } else {
      delete operation.security
    }
  }

  return normalized
}

export async function getPublicAuthOpenAPI(): Promise<{
  paths: Paths
  components: Components
}> {
  const authSpec = await auth.api.generateOpenAPISchema()
  const paths: Paths = {}
  const schemas: NonNullable<Components['schemas']> = {}

  for (const [path, pathItem] of Object.entries(authSpec.paths ?? {})) {
    if (!PUBLIC_AUTH_PATHS.has(path)) {
      continue
    }

    paths[`/auth${path}`] = normalizeAuthPathItem(path, pathItem)
  }

  if (authSpec.components?.schemas?.User) {
    schemas.BetterAuthUser = rewriteSchemaRefs(
      cloneOpenAPIValue(authSpec.components.schemas.User)
    ) as NonNullable<Components['schemas']>[string]
  }

  if (authSpec.components?.schemas?.Session) {
    schemas.BetterAuthSession = rewriteSchemaRefs(
      cloneOpenAPIValue(authSpec.components.schemas.Session)
    ) as NonNullable<Components['schemas']>[string]
  }

  return {
    paths,
    components: {
      schemas,
      securitySchemes: {
        betterAuthCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'Better Auth session cookie'
        }
      }
    }
  }
}

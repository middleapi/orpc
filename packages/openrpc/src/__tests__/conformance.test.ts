import type { JsonRpcParams } from '../json-rpc'
import type { OpenRPCDocument, OpenRPCErrorObject, OpenRPCExampleObject, OpenRPCExamplePairingObject, OpenRPCMethodObject } from '../types'
import { MethodCallValidator, ParameterValidationError, parseOpenRPCDocument, validateOpenRPCDocument } from '@open-rpc/schema-utils-js'
import { clone } from '@orpc/shared'
import { JSON_RPC_ERROR_CODES } from '../constants'
import { OpenRPCDiscoveryHandlerPlugin } from '../plugins'
import {
  createGenerator,
  createHandler,
  CUSTOM_ERROR_CODE_MAP,
  ERROR_CALLS,
  EXCLUDED_METHODS,
  filter,
  INVALID_CALLS,
  post,
  router,
  SUCCESS_CALLS,
  toDocumentedParams,
} from './fixtures'

/**
 * The document type of `@open-rpc/schema-utils-js`.
 */
type OpenrpcDocument = Parameters<typeof validateOpenRPCDocument>[0]

function toRequest(id: number, method: string, params: JsonRpcParams | undefined): unknown {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined && { params }) }
}

function getMethod(doc: OpenRPCDocument, name: string): OpenRPCMethodObject {
  const method = doc.methods.find(method => 'name' in method && method.name === name)

  if (method === undefined) {
    throw new Error(`The document has no method named "${name}"`)
  }

  return method as OpenRPCMethodObject
}

/**
 * Builds the params of an example pairing the way a generic client reads them.
 */
function toExampleParams(method: OpenRPCMethodObject, example: OpenRPCExamplePairingObject): JsonRpcParams | undefined {
  const params = example.params as OpenRPCExampleObject[]

  if (method.params.length === 0) {
    return undefined
  }

  return method.paramStructure === 'by-name'
    ? Object.fromEntries(params.map(param => [param.name, param.value]))
    : params.map(param => param.value)
}

/**
 * A validator of results: `MethodCallValidator` checks params only, so each method gets its result descriptor
 * as its single by-position param.
 */
function createResultValidator(doc: OpenrpcDocument): MethodCallValidator {
  return new MethodCallValidator({
    ...doc,
    methods: doc.methods.map((method: any) => ({
      ...method,
      paramStructure: 'by-position',
      params: [{ ...method.result, required: true }],
    })),
  })
}

describe.each(['1.3.2', '1.4.1'] as const)('conformance with @open-rpc/schema-utils-js (OpenRPC %s)', (version) => {
  const handler = createHandler()

  let doc: OpenRPCDocument
  let validator: MethodCallValidator
  let resultValidator: MethodCallValidator

  beforeAll(async () => {
    doc = await createGenerator().generate(router, { filter, version })

    // validates the document against the OpenRPC meta-schema, then dereferences it
    const parsed = await parseOpenRPCDocument(clone(doc) as unknown as OpenrpcDocument)

    validator = new MethodCallValidator(parsed)
    resultValidator = createResultValidator(parsed)
  })

  it('generates a valid document', () => {
    expect(doc.openrpc).toBe(version)
    expect(validateOpenRPCDocument(doc as unknown as OpenrpcDocument)).toBe(true)
  })

  it('documents the methods the handler serves', async () => {
    const names = doc.methods.map(method => (method as OpenRPCMethodObject).name)

    // every documented method is covered by the calls below
    expect(new Set([...SUCCESS_CALLS, ...ERROR_CALLS].map(call => call.method))).toEqual(new Set(names))

    for (const name of EXCLUDED_METHODS) {
      expect(names).not.toContain(name)

      const { body } = await post(handler, toRequest(1, name, undefined))

      expect(body).toEqual({ jsonrpc: '2.0', id: 1, error: { code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, message: 'Method not found' } })
    }
  })

  it.each(SUCCESS_CALLS)('$method($input): documented params are valid and the result matches the document', async ({ method, input, result }) => {
    const params = toDocumentedParams(getMethod(doc, method), input)

    expect(validator.validate(method, params ?? [])).toEqual([])

    const response = await post(handler, toRequest(1, method, params))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ jsonrpc: '2.0', id: 1, result })
    expect(resultValidator.validate(method, [result])).toEqual([])
  })

  it('validates results against the document', () => {
    // guards the result validator itself: results the document does not describe are rejected
    expect(resultValidator.validate('planet.find', [{ id: 1, name: 'Earth' }])).toEqual([expect.any(ParameterValidationError)])
    expect(resultValidator.validate('planet.get', ['Earth'])).toEqual([expect.any(ParameterValidationError)])
    expect(resultValidator.validate('planet.remove', [1])).toEqual([expect.any(ParameterValidationError)])
    expect(resultValidator.validate('get_data', [['hello', 5, 6]])).toEqual([expect.any(ParameterValidationError)])
  })

  it('answers methods without params whichever empty params a client sends', async () => {
    const methods = doc.methods.filter(method => (method as OpenRPCMethodObject).params.length === 0) as OpenRPCMethodObject[]

    expect(methods.length).toBeGreaterThan(0)

    for (const method of methods) {
      // no `paramStructure` means "either"
      expect(method.paramStructure).toBeUndefined()

      const { body: expected } = await post(handler, toRequest(1, method.name, undefined))

      expect(expected).not.toHaveProperty('error.code', JSON_RPC_ERROR_CODES.INVALID_PARAMS)

      for (const params of [[], {}, null]) {
        expect(validator.validate(method.name, params ?? [])).toEqual([])
        await expect(post(handler, { jsonrpc: '2.0', id: 1, method: method.name, params })).resolves.toMatchObject({ body: expected })
      }
    }
  })

  it.each(ERROR_CALLS)('$method($input): the error is one the method documents', async ({ method, input, error }) => {
    const documented = getMethod(doc, method)
    const params = toDocumentedParams(documented, input)

    expect(validator.validate(method, params ?? [])).toEqual([])

    const { body } = await post(handler, toRequest(1, method, params)) as { body: { error: OpenRPCErrorObject } }
    const documentedError = documented.errors?.find(documentedError => (documentedError as OpenRPCErrorObject).code === body.error.code) as OpenRPCErrorObject | undefined

    expect(documentedError).toBeDefined()
    expect(body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: documentedError!.code,
        message: error.message,
        data: { code: error.code, defined: true, ...(error.data !== undefined && { data: error.data }) },
      },
    })

    // codes shared by several errors are documented without data
    if (documentedError!.data !== undefined) {
      expect(documentedError).toEqual({ code: body.error.code, message: error.message, data: { code: error.code, defined: true } })
    }
  })

  it.each(INVALID_CALLS)('$method($input): params the document rejects are rejected with "Invalid params"', async ({ method, input }) => {
    const params = toDocumentedParams(getMethod(doc, method), input)

    expect(validator.validate(method, params ?? [])).toEqual(expect.arrayContaining([expect.any(ParameterValidationError)]))

    const { body } = await post(handler, toRequest(1, method, params))

    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      error: { code: JSON_RPC_ERROR_CODES.INVALID_PARAMS, data: { code: 'BAD_REQUEST', defined: false } },
    })
  })

  it('answers every documented example with its result', async () => {
    let replayed = 0

    for (const method of doc.methods as OpenRPCMethodObject[]) {
      for (const example of (method.examples ?? []) as OpenRPCExamplePairingObject[]) {
        const params = toExampleParams(method, example)

        expect(validator.validate(method.name, params ?? [])).toEqual([])

        const { body } = await post(handler, toRequest(1, method.name, params))

        expect(body).toEqual({ jsonrpc: '2.0', id: 1, result: (example.result as OpenRPCExampleObject).value })
        replayed++
      }
    }

    expect(replayed).toBe(3)
  })

  it('serves the same document through rpc.discover', async () => {
    const handler = createHandler({ plugins: [new OpenRPCDiscoveryHandlerPlugin({ spec: doc })] })

    const { body } = await post(handler, toRequest(1, 'rpc.discover', undefined)) as { body: { result: OpenrpcDocument } }

    expect(body.result).toEqual(doc)
    expect(validateOpenRPCDocument(body.result)).toBe(true)
  })
})

it('uses the same custom error code map in the document and in responses', async () => {
  const doc = await createGenerator().generate(router, { filter, errorCodeMap: CUSTOM_ERROR_CODE_MAP })
  const handler = createHandler({ errorCodeMap: CUSTOM_ERROR_CODE_MAP })

  expect(validateOpenRPCDocument(doc as unknown as OpenrpcDocument)).toBe(true)
  expect(getMethod(doc, 'planet.reserve').errors).toEqual([
    { code: 1001, message: 'No planets left', data: { code: 'OUT_OF_STOCK', defined: true } },
  ])

  await expect(post(handler, toRequest(1, 'planet.reserve', { id: 1 }))).resolves.toEqual({
    status: 200,
    contentType: 'application/json',
    body: {
      jsonrpc: '2.0',
      id: 1,
      error: { code: 1001, message: 'No planets left', data: { code: 'OUT_OF_STOCK', defined: true, data: { available: 0 } } },
    },
  })
})

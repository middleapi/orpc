import type { StandardHeaders } from '@standard-server/core'
import type { OpenAPISerializer } from '../../openapi-serializer'
import { isTypescriptObject, NullProtoObj, toArray } from '@orpc/shared'
import { toStandardHeaders } from '@standard-server/fetch'

/**
 * Converts link headers into standard headers with lowercase names,
 * so they merge with other headers and `content-type` is recognized by the fetch adapter.
 */
export function toResolvedStandardHeaders(headers: Headers | StandardHeaders): StandardHeaders {
  if (isHeadersInstance(headers)) {
    return toStandardHeaders(headers)
  }

  const result = new NullProtoObj<Record<string, string | string[] | undefined>>()

  for (const key of Object.keys(headers)) {
    appendHeader(result, key, headers[key])
  }

  return result
}

export function serializeHeaders(
  headers: object,
  serializer: Pick<OpenAPISerializer, 'serialize'>,
): StandardHeaders {
  if (isHeadersInstance(headers)) {
    return toStandardHeaders(headers)
  }

  const result = new NullProtoObj<Record<string, string | string[] | undefined>>()

  for (const [key, value] of Object.entries(headers)) {
    /**
     * Only an actual array value represents a multi-value header (sent as multiple lines).
     * Serialization can turn non-array values into arrays (e.g. Set, Map, custom handlers),
     * and those must stay a single line, so the structure is checked before serializing.
     */
    if (Array.isArray(value)) {
      const lines: string[] = []

      for (const item of value) {
        const line = serializeHeaderValue(item, serializer)

        if (line !== undefined) {
          lines.push(line)
        }
      }

      appendHeader(result, key, lines)
      continue
    }

    const line = serializeHeaderValue(value, serializer)

    if (line !== undefined) {
      appendHeader(result, key, line)
    }
  }

  return result
}

/**
 * Headers class might not be available in some environments,
 * so we check for the existence of `forEach` method to determine if it's a Headers instance.
 */
function isHeadersInstance(headers: object): headers is Headers {
  return typeof (headers as Partial<Headers>).forEach === 'function'
}

/**
 * Lowercases the header name and merges its value into the existing one the same way `mergeStandardHeaders` does.
 */
function appendHeader(headers: StandardHeaders, name: string, value: StandardHeaders[string]): void {
  const key = name.toLowerCase()
  const current = headers[key]

  headers[key] = current === undefined || value === undefined
    ? current ?? value
    : [...toArray(current), ...toArray(value)]
}

function serializeHeaderValue(
  value: unknown,
  serializer: Pick<OpenAPISerializer, 'serialize'>,
): string | undefined {
  const serialized = serializer.serialize(value)

  if (Array.isArray(serialized)) {
    return serialized
      .filter(item => item !== undefined && item !== null)
      .map(String)
      .join(',')
  }

  if (isTypescriptObject(serialized)) {
    return Object.entries(serialized)
      .filter(([, val]) => val !== undefined && val !== null)
      .map(([key, val]) => `${String(key)},${String(val)}`)
      .join(',')
  }

  if (serialized !== undefined && serialized !== null) {
    return String(serialized)
  }

  return undefined
}

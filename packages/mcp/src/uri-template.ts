/**
 * Minimal URI-template support for MCP resources.
 *
 * Handles RFC 6570 level-1 simple string expansion (`{var}`), which is what
 * resource templates like `planet://{id}` need: each `{var}` matches a single
 * path segment (no `/`). Static URIs (no `{}`) are matched exactly.
 */

import { tryDecodeURIComponent } from '@orpc/shared'

export interface CompiledUriTemplate {
  /** The original template string. */
  template: string
  /** Variable names, in order of appearance. */
  variables: string[]
  /**
   * Match a concrete URI against the template.
   * Returns the extracted, URI-decoded variables, or `undefined` on no match.
   */
  match: (uri: string) => Record<string, string> | undefined
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function compileUriTemplate(template: string): CompiledUriTemplate {
  const variables: string[] = []
  const placeholder = /\{(\w+)\}/g

  let pattern = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  // eslint-disable-next-line no-cond-assign
  while ((match = placeholder.exec(template)) !== null) {
    pattern += escapeRegExp(template.slice(lastIndex, match.index))
    variables.push(match[1]!)
    pattern += '([^/]+)'
    lastIndex = match.index + match[0].length
  }
  pattern += escapeRegExp(template.slice(lastIndex))

  const regex = new RegExp(`^${pattern}$`)

  return {
    template,
    variables,
    match(uri) {
      const result = regex.exec(uri)
      if (!result) {
        return undefined
      }

      const extracted: Record<string, string> = {}
      variables.forEach((name, index) => {
        extracted[name] = tryDecodeURIComponent(result[index + 1]!)
      })
      return extracted
    },
  }
}

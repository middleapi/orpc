import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { stringifyJSON } from '@orpc/shared'

/** Resolves the relative imports without an extension the sources are written with */
const RESOLVE_HOOKS = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (!specifier.startsWith('.')) throw error
    for (const suffix of ['.ts', '/index.ts']) {
      try {
        return await next(specifier + suffix, context)
      } catch {}
    }
    throw error
  }
}`

const toDataURL = (code: string) =>
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

const REGISTER = `import { register } from 'node:module'; register(${stringifyJSON(toDataURL(RESOLVE_HOOKS))})`

/** Whether this Node.js runs the TypeScript sources itself, which the child process needs */
export const canGenerateWithin = process.allowedNodeEnvironmentFlags.has(
  '--experimental-transform-types',
)

/**
 * Generates the document of the `router` a file exports in a child process, stopped after
 * `timeout` milliseconds: the compiler's calls block the event loop, so a conversion that never
 * ends would hang the test run past any test timeout. Resolves to the document, or to the message
 * of the error it fails with.
 */
export function generateWithin(file: string, timeout: number): { spec?: any; error?: string } {
  const child = spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--no-warnings',
      '--import',
      toDataURL(REGISTER),
      fileURLToPath(new URL('./generate-child.ts', import.meta.url)),
      file,
    ],
    { encoding: 'utf8', timeout, killSignal: 'SIGKILL' },
  )

  if (child.error || child.status !== 0) {
    throw new Error(
      child.signal
        ? `Generation did not finish within ${timeout} ms`
        : `Generation failed: ${child.error?.message ?? child.stderr}`,
    )
  }

  return JSON.parse(child.stdout)
}

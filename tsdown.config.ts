import { readFileSync } from 'node:fs'

import { defineConfig, Rolldown } from 'tsdown'
import type { TsdownPlugin } from 'tsdown'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  exports: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const runtimeModules = ['bun', /^(bun|node|cloudflare):/]

export default defineConfig({
  entry: Object.values(pkg.exports).filter((path) => path.startsWith('./src/')),
  unbundle: true,
  deps: {
    neverBundle: true,
    onlyImport: [
      ...Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }),
      ...runtimeModules,
    ],
  },
  platform: 'neutral',
  target: 'es2022',
  dts: { generator: 'oxc' },
  inputOptions: { external: runtimeModules },
  plugins: [restoreReexports()],
})

const isExportList = (node: any): boolean =>
  node.type === 'ExportNamedDeclaration' && !node.source && !node.declaration

/**
 * Rolldown writes re-exports as `import { a } from 'x'; export { a }`, which
 * Expo's tree shaking can't see through. Turn them back into `export { a } from 'x'`.
 */
function restoreReexports(): TsdownPlugin {
  return {
    name: 'restore-reexports',
    renderChunk(code, chunk) {
      if (!chunk.fileName.endsWith('.js')) {
        return null
      }

      const text = (node: any): string => code.slice(node.start, node.end)

      const body: any[] = this.parse(code).body
      const imports = body.filter(
        (node) =>
          node.type === 'ImportDeclaration' &&
          !node.attributes.length &&
          node.specifiers.every((spec: any) => spec.type === 'ImportSpecifier'),
      )
      const exportLists = body.filter(isExportList)

      const used = new Set<string>()
      const collect = (node: any): void => {
        if (node && typeof node === 'object') {
          if (node.type === 'Identifier') {
            used.add(node.name)
          }
          Object.values(node).forEach(collect)
        }
      }
      collect(body.filter((node) => !imports.includes(node) && !exportLists.includes(node)))

      const exportsByLocal = new Map<string, string[]>()
      for (const spec of exportLists.flatMap((node) => node.specifiers)) {
        exportsByLocal.set(spec.local.name, [
          ...(exportsByLocal.get(spec.local.name) ?? []),
          text(spec.exported),
        ])
      }

      const s = new Rolldown.RolldownMagicString(code)
      const moved = new Set<string>()

      for (const node of imports) {
        const kept: string[] = []
        const reexported: string[] = []

        for (const spec of node.specifiers) {
          const local = spec.local.name
          const exported = exportsByLocal.get(local)

          if (exported && !used.has(local)) {
            moved.add(local)
            const imported = text(spec.imported)
            reexported.push(
              ...exported.map((as) => (as === imported ? as : `${imported} as ${as}`)),
            )
          } else {
            kept.push(text(spec))
          }
        }

        // Written in place of the import, so modules still evaluate in the same order.
        if (reexported.length) {
          const source = text(node.source)
          const imported = kept.length ? `import { ${kept.join(', ')} } from ${source};\n` : ''
          s.overwrite(
            node.start,
            node.end,
            `${imported}export { ${reexported.join(', ')} } from ${source};`,
          )
        }
      }

      for (const node of exportLists) {
        const left = node.specifiers.filter((spec: any) => !moved.has(spec.local.name))

        if (!left.length) {
          s.remove(node.start, node.end)
        } else if (left.length !== node.specifiers.length) {
          s.overwrite(node.start, node.end, `export { ${left.map(text).join(', ')} };`)
        }
      }

      return s
    },
  }
}

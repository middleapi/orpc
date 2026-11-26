import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import type { TypeScriptProject, TypeScriptProjectOptions } from './project'
import { openTypeScriptProject } from './project'

describe('openTypeScriptProject', () => {
  let root: string

  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }

  const open = <T>(options: TypeScriptProjectOptions, read: (project: TypeScriptProject) => T) => {
    const project = openTypeScriptProject(options)
    try {
      return read(project)
    } finally {
      project.close()
    }
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'orpc-inference-project-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('looks past several tsconfigs that do not include the file, naming only the nearest', () => {
    write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }))
    write('app/tsconfig.json', JSON.stringify({ include: ['src'] }))
    write('app/tools/tsconfig.json', JSON.stringify({ include: ['src'] }))
    write('app/tools/scripts/router.ts', 'export const router = 1\n')
    const file = path.join(root, 'app/tools/scripts/router.ts')
    const nearest = path.join(root, 'app/tools/tsconfig.json')

    expect(open({ file }, (project) => project.describeConfig())).toEqual([
      `"${nearest}" does not include "${file}".`,
      `error TS18003: No inputs were found in config file '${nearest}'. Specified 'include' paths were '["src"]' and 'exclude' paths were '[]'.`,
      `Using the compiler options of "${path.join(root, 'tsconfig.json')}".`,
    ])
  })

  it('looks past a tsconfig.json the compiler can not load, a directory', () => {
    mkdirSync(path.join(root, 'tsconfig.json'))
    write('router.ts', 'export const router = 1\n')
    const file = path.join(root, 'router.ts')

    expect(open({ file }, (project) => project.describeConfig())).toEqual([
      `"${path.join(root, 'tsconfig.json')}" does not include "${file}".`,
      `Using default compiler options, no tsconfig.json includes "${file}".`,
    ])

    // passed, it loads no project
    expect(() => openTypeScriptProject({ file, tsconfig: root })).toThrow(
      `[TypeScript] Could not load the project for "${path.join(root, 'tsconfig.json')}".`,
    )
  })

  it('reads the references of a solution tsconfig that exist once, also of broken tsconfigs', () => {
    write(
      'tsconfig.json',
      `{
        // itself, twice the app, a missing project, a broken tsconfig, and no references
        "files": [],
        "references": [
          { "path": "." },
          { "path": "./app" },
          { "path": "./app/tsconfig.json" },
          { "path": "./missing" },
          { "path": "./broken" },
          1,
          null,
        ],
      }`,
    )
    write('app/tsconfig.json', JSON.stringify({ include: ['.'] }))
    write('app/router.ts', 'export const router = 1\n')
    write('broken/tsconfig.json', '{ "references": [ }')

    expect(
      open({ file: path.join(root, 'app/router.ts'), tsconfig: root }, (project) =>
        project.describeConfig(),
      ),
    ).toEqual([`Using the compiler options of "${path.join(root, 'app/tsconfig.json')}".`])
  })

  it('reads the references of a solution tsconfig starting with a byte order mark', () => {
    write(
      'tsconfig.json',
      `\uFEFF${JSON.stringify({ files: [], references: [{ path: './app' }] })}`,
    )
    write('app/tsconfig.json', JSON.stringify({ include: ['.'] }))
    write('app/router.ts', 'export const router = 1\n')

    expect(
      open({ file: path.join(root, 'app/router.ts'), tsconfig: root }, (project) =>
        project.describeConfig(),
      ),
    ).toEqual([`Using the compiler options of "${path.join(root, 'app/tsconfig.json')}".`])
  })

  // the old trailing comma regex backtracked exponentially on these, never finishing
  it('reads the references of tsconfigs with a slash banner and back-to-back block comments', () => {
    write(
      'tsconfig.json',
      `{
        "files": [],
        "references": [{ "path": "./app" }],
        ${'/* reference */'.repeat(40)}
      }`,
    )
    write(
      'app/tsconfig.json',
      `{
        "compilerOptions": {
          "strict": true,
          ${'/'.repeat(80)}
          "noEmit": true,
${'          /* option */\n'.repeat(40)}
        },
        "include": ["."],
      }`,
    )
    write('app/router.ts', 'export const router = 1\n')

    expect(
      open({ file: path.join(root, 'app/router.ts'), tsconfig: root }, (project) =>
        project.describeConfig(),
      ),
    ).toEqual([`Using the compiler options of "${path.join(root, 'app/tsconfig.json')}".`])
  })

  it('reads the references of a solution tsconfig keeping strings with comment markers and commas', () => {
    write(
      'tsconfig.json',
      `{
        "files": [],
        "references": [
          { "path": "./*/../a,b//c", }, // trailing commas before comments
          /* and */
        ],
      }`,
    )
    write('a,b/c/tsconfig.json', JSON.stringify({ include: ['.'] }))
    write('a,b/c/router.ts', 'export const router = 1\n')

    expect(
      open({ file: path.join(root, 'a,b/c/router.ts'), tsconfig: root }, (project) =>
        project.describeConfig(),
      ),
    ).toEqual([`Using the compiler options of "${path.join(root, 'a,b/c/tsconfig.json')}".`])
  })

  it('lists no exports of a script, read from a path relative to the current working directory', () => {
    write('tsconfig.json', JSON.stringify({ include: ['*.ts'] }))
    write('script.ts', 'const router = 1\n')
    const file = path.join(root, 'script.ts')

    expect(() =>
      open({ file: path.relative(process.cwd(), file) }, (project) =>
        project.getExportType('router'),
      ),
    ).toThrow(`[TypeScript] "${file}" has no export named "router". Available exports: (none).`)
  })
})

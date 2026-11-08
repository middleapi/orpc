import { openTypeScriptProject } from '../src/project.ts'
import { TypeToJsonSchemaConverter } from '../src/type-converter.ts'

const FIXTURE = new URL('./scratch/src/a.ts', import.meta.url)
const NAMES = (process.env.NAMES ?? '').split(',').filter(Boolean)

it('scratch', () => {
  const project = openTypeScriptProject({ file: FIXTURE })
  try {
    process.stdout.write(JSON.stringify(project.program.getSemanticDiagnostics(project.sourceFile.fileName).map((d: any) => d.messageText ?? d.message ?? d)) + '\n')
    const mode = (process.env.DEFS_MODE as any) || 'named'
    const converter = new TypeToJsonSchemaConverter(project.checker, project.program, { defs: mode })
    for (const name of NAMES) {
      try {
        const r = converter.convert(project.getExportType(name).type)
        process.stdout.write(`== ${name}: ${JSON.stringify(r)}\n`)
      } catch (e: any) {
        process.stdout.write(`== ${name}: THROW ${e.message}\n`)
      }
    }
  } finally {
    project.close()
  }
})

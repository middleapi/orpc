import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

interface Sponsor {
  name: string | null
  login: string
  avatar: string
  amount: number
  createdAt: string
  tierTitle: string
  tierLevel: number
  link: string
  org: boolean
  sidebarSize?: string
  sidebarLogo?: string
  [key: string]: unknown
}

const SPONSORS_SOURCE_URL = 'https://raw.githubusercontent.com/middleapi/static/refs/heads/main/sponsors.json'
const ROOT_DIR = process.cwd()
const README_FILE_NAME = 'README.md'
const WEBSITE_SPONSORS_FILE = path.join(ROOT_DIR, 'apps/content/.vitepress/theme/sponsors.ts')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.output', '.next', '.nuxt', '.turbo'])

async function findReadmes(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const result: string[] = []
  const subdirPromises: Promise<string[]>[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue
      }

      subdirPromises.push(findReadmes(fullPath))
    }
    else if (entry.isFile() && entry.name === README_FILE_NAME) {
      result.push(fullPath)
    }
  }

  const subResults = await Promise.all(subdirPromises)
  return result.concat(...subResults)
}

function withTracking(url: string): string {
  try {
    const tracked = new URL(url)

    tracked.searchParams.set('ref', 'orpc')

    return tracked.toString()
  }
  catch {
    return url
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function getTierImageSizeAndColumns(tierLevel: number, tierLevels: number[]): [columns: number, imageSize: number] {
  const rank = tierLevels.findIndex(level => level === tierLevel)

  const columnByRank = [3, 4, 5, 6, 7, 8]
  const column = columnByRank[Math.min(rank, columnByRank.length - 1)] ?? 3
  return [column, Math.floor(838 / column)]
}

function buildSponsorsSection(sponsors: Sponsor[]): string {
  const activeSponsors = sponsors.filter(sponsor => sponsor.tierLevel > 0 && sponsor.amount > 0)
  const pastSponsors = sponsors.filter(sponsor => sponsor.tierLevel <= 0 || sponsor.amount <= 0)

  const groupedSponsors = new Map<number, Sponsor[]>()

  for (const sponsor of activeSponsors) {
    const group = groupedSponsors.get(sponsor.tierLevel)

    if (group) {
      group.push(sponsor)
      continue
    }

    groupedSponsors.set(sponsor.tierLevel, [sponsor])
  }

  const lines = [
    '## Sponsors',
    '',
    'If you find oRPC valuable and would like to support its development, you can do so here: [GitHub Sponsors](https://github.com/sponsors/dinwwwh).',
    '',
  ]

  const tierLevels = [...groupedSponsors.keys()].sort((a, b) => b - a)

  for (const tierLevel of tierLevels) {
    const tierSponsors = groupedSponsors.get(tierLevel)

    if (!tierSponsors || tierSponsors.length === 0) {
      continue
    }

    const tierTitle = tierSponsors[0]?.tierTitle ?? `Tier ${tierLevel}`
    const [columns, imageSize] = getTierImageSizeAndColumns(tierLevel, tierLevels)

    lines.push(`### ${tierTitle}`)
    lines.push('')
    lines.push('<table>')
    lines.push('  <tr>')

    for (const [index, sponsor] of tierSponsors.entries()) {
      const href = sponsor.link
      const displayName = sponsor.name ?? sponsor.login
      const escapedName = escapeHtml(displayName)

      lines.push(`   <td align="center"><a href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${escapedName}"><img src="${escapeHtml(sponsor.avatar)}" width="${imageSize}" alt="${escapedName}"/><br />${escapedName}</a></td>`)

      const isRowEnd = (index + 1) % columns === 0
      const isLast = index === tierSponsors.length - 1

      if (isRowEnd && !isLast) {
        lines.push('  </tr>')
        lines.push('  <tr>')
      }
    }

    lines.push('  </tr>')
    lines.push('</table>')
    lines.push('')
  }

  if (pastSponsors.length > 0) {
    lines.push('### Past Sponsors')
    lines.push('')
    lines.push('<p>')

    for (const sponsor of pastSponsors) {
      const href = sponsor.link
      const displayName = sponsor.name ?? sponsor.login
      const escapedName = escapeHtml(displayName)

      lines.push(`  <a href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${escapedName}"><img src="${escapeHtml(sponsor.avatar)}" width="32" height="32" alt="${escapedName}" /></a>`)
    }

    lines.push('</p>')
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

function replaceSponsorsSection(content: string, replacement: string): string {
  const heading = '## Sponsors'
  const startIndex = content.indexOf(heading)

  if (startIndex === -1) {
    return content
  }

  const nextHeadingIndex = content.indexOf('\n## ', startIndex + heading.length)
  const endIndex = nextHeadingIndex === -1 ? content.length : nextHeadingIndex + 1

  return `${content.slice(0, startIndex)}${replacement}${content.slice(endIndex)}`
}

function buildWebsiteSponsorsFileContent(sponsors: Sponsor[]): string {
  const normalizedSponsors = sponsors.map((sponsor) => {
    const createdAt = typeof sponsor.createdAt === 'string' && sponsor.createdAt.length > 0
      ? sponsor.createdAt
      : undefined

    const sidebarSize = sponsor.sidebarSize === 'normal' || sponsor.sidebarSize === 'small' || sponsor.sidebarSize === 'none'
      ? sponsor.sidebarSize
      : 'none'

    const sidebarLogo = typeof sponsor.sidebarLogo === 'string' && sponsor.sidebarLogo.length > 0
      ? sponsor.sidebarLogo
      : sponsor.avatar

    return {
      name: sponsor.name,
      login: sponsor.login,
      avatar: sponsor.avatar,
      amount: sponsor.amount,
      link: sponsor.link,
      org: sponsor.org,
      ...(createdAt ? { createdAt } : {}),
      tierTitle: sponsor.tierTitle,
      tierLevel: sponsor.tierLevel,
      sidebarSize,
      sidebarLogo,
    }
  })
  // eslint-disable-next-line ban/ban
  const sponsorsJson = JSON.stringify(normalizedSponsors, null, 2)

  return `// This file is auto-generated by scripts/sync-sponsor.ts. Do not edit manually.

export type SidebarPlacementSize = 'normal' | 'small' | 'none'

export interface JSONSponsor {
  name: string | null
  login: string
  avatar: string
  amount: number
  link: string
  org: boolean
  createdAt?: string
  tierTitle: string
  tierLevel: number
  sidebarSize: SidebarPlacementSize
  sidebarLogo: string
}

export const sponsors: JSONSponsor[] = ${sponsorsJson}
`
}

async function writeWebsiteSponsorsFile(sponsors: Sponsor[]): Promise<void> {
  await mkdir(path.dirname(WEBSITE_SPONSORS_FILE), { recursive: true })
  const content = buildWebsiteSponsorsFileContent(sponsors)
  await writeFile(WEBSITE_SPONSORS_FILE, content)
}

async function main(): Promise<void> {
  const response = await fetch(SPONSORS_SOURCE_URL)

  if (!response.ok) {
    throw new Error(`Failed to fetch sponsors data: ${response.status} ${response.statusText}`)
  }

  const sponsors = (await response.json() as Sponsor[]).map(sponsor => ({ ...sponsor, link: withTracking(sponsor.link) }))
  await writeWebsiteSponsorsFile(sponsors)
  const readmeFiles = await findReadmes(ROOT_DIR)
  const replacement = buildSponsorsSection(sponsors)

  const readmeContents = await Promise.all(
    readmeFiles.map(readmePath => readFile(readmePath, 'utf8')),
  )

  const writePromises: Promise<void>[] = []
  let updatedCount = 0

  for (const [i, content] of readmeContents.entries()) {
    const nextContent = replaceSponsorsSection(content, replacement)

    if (nextContent !== content) {
      writePromises.push(writeFile(readmeFiles[i]!, nextContent))
      updatedCount += 1
    }
  }

  await Promise.all(writePromises)
  console.log(`Updated sponsors section in ${updatedCount} README files.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

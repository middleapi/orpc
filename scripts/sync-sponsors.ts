import { readdir, readFile, writeFile } from 'node:fs/promises'
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

interface Ad {
  name: string
  description: string
  logo: string
  href: string
  /** Relative appearance frequency; defaults to 1. */
  weight?: number
}

const SPONSORS_SOURCE_URL = 'https://raw.githubusercontent.com/middleapi/static/refs/heads/main/sponsors.json'
const ADS_SOURCE_URL = 'https://raw.githubusercontent.com/middleapi/static/refs/heads/main/ads.json'
const ADS_OUTPUT_FILE = 'apps/content/sponsors/ads.ts'
const ROOT_DIR = process.cwd()
const README_FILE_NAME = 'README.md'

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
    'Like what we build over at [middleapi](https://github.com/middleapi)? You can help keep it going here: [GitHub Sponsors](https://github.com/sponsors/dinwwwh). Every bit helps! 🚀',
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

async function syncAds(): Promise<void> {
  const response = await fetch(ADS_SOURCE_URL)

  if (!response.ok) {
    throw new Error(`Failed to fetch ads data: ${response.status} ${response.statusText}`)
  }

  const ads = (await response.json() as Ad[])
    .filter(ad =>
      [ad.name, ad.description, ad.logo, ad.href].every(field => typeof field === 'string' && field !== ''),
    )
    .map(ad => ({
      name: ad.name,
      description: ad.description,
      logo: ad.logo,
      href: ad.href,
      weight: typeof ad.weight === 'number' && Number.isFinite(ad.weight) && ad.weight > 0 ? ad.weight : 1,
    }))

  const content = [
    '/* eslint-disable eslint-comments/no-unlimited-disable */',
    '/* eslint-disable */',
    `// Generated by scripts/sync-sponsors.ts from ${ADS_SOURCE_URL} — do not edit.`,
    '',
    // eslint-disable-next-line ban/ban
    `export default ${JSON.stringify(ads, null, 2)}`,
    '',
  ].join('\n')

  await writeFile(path.join(ROOT_DIR, ADS_OUTPUT_FILE), content)
  console.log(`Wrote ${ads.length} ads to ${ADS_OUTPUT_FILE}.`)
}

async function main(): Promise<void> {
  const [response] = await Promise.all([fetch(SPONSORS_SOURCE_URL), syncAds()])

  if (!response.ok) {
    throw new Error(`Failed to fetch sponsors data: ${response.status} ${response.statusText}`)
  }

  const sponsors = (await response.json() as Sponsor[]).map(sponsor => ({ ...sponsor, link: withTracking(sponsor.link) }))
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

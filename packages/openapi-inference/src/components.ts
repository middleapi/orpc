import { setOwn, stringifyJSON } from '@orpc/shared'

const COMPONENTS_REF_PREFIX = '#/components/schemas/'

/**
 * The def names of the conversions: every name given, and the ones numbered after a name another
 * def held when they were given (`DeepReadonly_A2` after `DeepReadonly_A`), with that name.
 */
export interface DefNameRecord {
  readonly used: ReadonlySet<string>
  readonly numbered: ReadonlyMap<string, string>
}

/**
 * Merges the components of defs of one name (but its number) describing the same values, which
 * the conversion emits apart for instantiations of one type within a cycle (`DeepNull<A>`, reached
 * once more through a union it distributes over), whose schemas only differ by the names of such
 * components they refer to.
 * A numbered name then takes the name it was numbered after, once no component has it
 * (a def holding `DeepReadonly_A` was replaced by a reference to `DeepReadonly_A2`).
 * Rewrites the references of the whole document, in place.
 */
export function mergeEquivalentComponents(document: any, names: DefNameRecord): void {
  const schemas: Record<string, unknown> | undefined = document?.components?.schemas

  if (!schemas) {
    return
  }

  const candidates = Object.keys(schemas).filter((name) => names.used.has(name))
  const isCandidate = new Set(candidates)

  // the JSON of each schema, without the names of the candidates it refers to, and those names
  const shapes = new Map<string, { shape: string; refs: string[] }>()

  for (const name of candidates) {
    const refs: string[] = []
    const shape = stringifyJSON(
      mapRefs(schemas[name], (target) => {
        if (!isCandidate.has(target)) {
          return target
        }
        refs.push(target)
        return ''
      }),
    )
    shapes.set(name, { shape: shape ?? '', refs })
  }

  // classes of equivalent components: of the same name but its number, of the same shape,
  // referring to equivalent ones in turn, refined until they no longer split
  let classes = new Map(
    candidates.map((name) => [
      name,
      `${names.numbered.get(name) ?? name}\u0000${shapes.get(name)!.shape}`,
    ]),
  )

  for (let count = 0; ;) {
    const ids = new Map<string, number>()
    const next = new Map<string, string>()

    for (const name of candidates) {
      const key = [classes.get(name), ...shapes.get(name)!.refs.map((r) => classes.get(r))].join(
        '\u0000',
      )
      let id = ids.get(key)
      if (id === undefined) {
        id = ids.size
        ids.set(key, id)
      }
      next.set(name, String(id))
    }

    classes = next
    if (ids.size === count) {
      break
    }
    count = ids.size
  }

  const members = new Map<string, string[]>()
  for (const name of candidates) {
    const id = classes.get(name)!
    members.set(id, [...(members.get(id) ?? []), name])
  }

  // the name not numbered, else the lowest numbered one
  const preference = (a: string, b: string) =>
    Number(names.numbered.has(a)) - Number(names.numbered.has(b)) ||
    a.length - b.length ||
    (a < b ? -1 : a > b ? 1 : 0)

  const merged = new Map<string, string>()

  for (const group of members.values()) {
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a copy
    const [kept, ...others] = [...group].sort(preference)
    for (const name of others) {
      merged.set(name, kept!)
    }
  }

  const remaining = Object.keys(schemas).filter((name) => !merged.has(name))
  const renamed = new Map<string, string>()
  const taken = new Set(remaining)

  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a copy
  for (const name of remaining.filter((n) => names.numbered.has(n)).sort(preference)) {
    const base = names.numbered.get(name)!
    if (!taken.has(base)) {
      taken.add(base)
      renamed.set(name, base)
    }
  }

  if (!merged.size && !renamed.size) {
    return
  }

  const resolve = (name: string) => {
    const kept = merged.get(name) ?? name
    return renamed.get(kept) ?? kept
  }

  const entries = Object.entries(schemas)
  for (const name of Object.keys(schemas)) {
    delete schemas[name]
  }
  for (const [name, schema] of entries) {
    if (!merged.has(name)) {
      setOwn(schemas, resolve(name), schema)
    }
  }

  rewriteRefs(document, resolve)
}

/**
 * A copy of a value with the names of the components it refers to mapped.
 */
function mapRefs(value: unknown, map: (name: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapRefs(item, map))
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  const copy: Record<string, unknown> = {}

  for (const [key, child] of Object.entries(value)) {
    setOwn(
      copy,
      key,
      key === '$ref' && typeof child === 'string' && child.startsWith(COMPONENTS_REF_PREFIX)
        ? COMPONENTS_REF_PREFIX + map(decodeName(child.slice(COMPONENTS_REF_PREFIX.length)))
        : mapRefs(child, map),
    )
  }

  return copy
}

function rewriteRefs(value: unknown, resolve: (name: string) => string): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      rewriteRefs(item, resolve)
    }
    return
  }

  if (typeof value !== 'object' || value === null) {
    return
  }

  const object = value as Record<string, unknown>

  for (const key of Object.keys(object)) {
    const child = object[key]

    if (key === '$ref' && typeof child === 'string' && child.startsWith(COMPONENTS_REF_PREFIX)) {
      const name = decodeName(child.slice(COMPONENTS_REF_PREFIX.length))
      const resolved = resolve(name)
      if (resolved !== name) {
        object[key] = COMPONENTS_REF_PREFIX + encodeName(resolved)
      }
    } else {
      rewriteRefs(child, resolve)
    }
  }
}

function decodeName(segment: string): string {
  return segment.replace(/~1/gu, '/').replace(/~0/gu, '~')
}

function encodeName(name: string): string {
  return name.replace(/~/gu, '~0').replace(/\//gu, '~1')
}

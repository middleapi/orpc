import type { JsonSchema } from '@orpc/json-schema'
import {
  decodeJsonPointerSegment,
  encodeJsonPointerSegment,
  mapJsonSchemaRefs,
} from '@orpc/json-schema'
import { setOwn, stringifyJSON } from '@orpc/shared'

const COMPONENTS_REF_PREFIX = '#/components/schemas/'

/**
 * The def names of the conversions: every name given, and the ones numbered after a name another
 * def held when they were given (`DeepReadonly_A2` after `DeepReadonly_A`), with that name, or
 * named by a mode a def of the same type in another mode shared (`PointJson` of `Point`).
 */
export interface DefNameRecord {
  readonly used: ReadonlySet<string>
  readonly numbered: ReadonlyMap<string, string>
  /** Names of a type in a mode, with the name of the type without it (`PointJson` of `Point`) */
  readonly modes?: ReadonlyMap<string, string> | undefined
  /**
   * Names of the forms of types as parameters (`HolderParam` of `Holder`), which yield to a type
   * of that name (a declared `HolderParam`)
   */
  readonly parameters?: ReadonlySet<string> | undefined
  /**
   * Names of defs named after a project alias their type lost, which yield to a def of another
   * type numbered after that name (a declared `User` given `User2`)
   */
  readonly aliased?: ReadonlySet<string> | undefined
}

export interface MergeEquivalentComponentsOptions {
  /**
   * Components the conversion did not name, like those of `base`, which are neither merged nor
   * renamed.
   */
  reserved?: ReadonlySet<string> | undefined
  /**
   * The def names of components given other names, by `componentName`
   */
  defNames?: ReadonlyMap<string, string> | undefined
  /**
   * The name of the component of a def, which `componentName` chose (with `defNames`), for the name
   * a numbered one takes (`Acme.Role` of `Acme.RoleParam`).
   *
   * @default defName => defName
   */
  componentName?: ((defName: string, schema: JsonSchema) => string) | undefined
}

/**
 * Merges the components of defs of one name (but its number or mode) describing the same values,
 * which the conversion emits apart for instantiations of one type within a cycle (`DeepNull<A>`,
 * reached once more through a union it distributes over), whose schemas only differ by the names
 * of such components they refer to, and for a type converted the same in two modes by the
 * converters of inputs and outputs (`Point` and `PointJson`), which takes the shorter name.
 * A numbered name then takes the name it was numbered after, once no component has it
 * (a def holding `DeepReadonly_A` was replaced by a reference to `DeepReadonly_A2`).
 * Rewrites the references of the whole document, in place.
 */
export function mergeEquivalentComponents(
  document: any,
  defNameRecord: DefNameRecord,
  {
    reserved = new Set(),
    defNames: givenDefNames,
    componentName,
  }: MergeEquivalentComponentsOptions = {},
): void {
  const schemas: Record<string, unknown> | undefined = document?.components?.schemas

  if (!schemas) {
    return
  }

  // the stock generator keys components by valid names (`_Role` of `$Role`)
  const names = toValidDefNameRecord(defNameRecord)
  const rename = !componentName
  const defNames = toValidMap(givenDefNames)

  // a def whose name (or the one `componentName` gave it) a component of `base` has is given one of
  // a direction by the stock generator (`RoleInput`), which the other direction reuses: it is
  // merged as a def of that name, and takes a numbered name instead (`Role2`); a def described
  // otherwise in the other direction is given one too (`NodeInput` of `Node`), a sibling merged as
  // one of the def in that direction, which follows the name of the def's component
  const directed = new Map<
    string,
    { def: string; base: string; direction: string; sibling: boolean }
  >()
  for (const name of Object.keys(schemas)) {
    const [, base, direction] = /^(.+)(Input|Output)$/u.exec(name) ?? []
    const sibling = !!base && !reserved.has(base) && Object.hasOwn(schemas, base)
    const def =
      base && (sibling || reserved.has(base)) ? (rename ? base : defNames?.get(base)) : undefined
    if (def && names.used.has(def) && !(rename ? names.used.has(name) : defNames?.has(name))) {
      directed.set(name, { def, base: base!, direction: direction!, sibling })
    }
  }

  const defName = (name: string) => defNames?.get(name) ?? directed.get(name)?.def ?? name

  // only the components of the conversion's own defs
  const candidates = Object.keys(schemas).filter(
    (name) => names.used.has(defName(name)) && !reserved.has(name),
  )
  const isCandidate = new Set(candidates)

  // components of the same name but its number, of the same JSON without the names of the
  // candidates they refer to, referring to equivalent ones in turn
  const refs = new Map<string, string[]>()
  const shapes = new Map(
    candidates.map((name) => {
      const targets: string[] = []
      const shape = mapComponentRefs(schemas[name] as JsonSchema, (target) => {
        if (!isCandidate.has(target)) {
          return target
        }
        targets.push(target)
        return ''
      })
      refs.set(name, targets)
      const def = defName(name)
      return [
        name,
        [
          names.modes?.get(def) ?? names.numbered.get(def) ?? def,
          directed.get(name)?.sibling ? directed.get(name)!.direction : '',
          stringifyJSON(shape),
        ].join('\u0000'),
      ]
    }),
  )
  const groups = getEquivalenceClasses(shapes, refs)

  // the name not numbered, else the lowest numbered one
  const preference = (a: string, b: string) =>
    Number(names.numbered.has(defName(a))) - Number(names.numbered.has(defName(b))) ||
    defName(a).length - defName(b).length ||
    (a < b ? -1 : a > b ? 1 : 0)

  // the name of the component `componentName` gave a def, or would give it
  const componentNames = new Map([...(defNames ?? [])].map(([name, def]) => [def, name]))
  const nameOf = (def: string | undefined, schema: unknown) =>
    def === undefined || !componentName
      ? def
      : (componentNames.get(def) ?? toValidComponentName(componentName(def, schema as JsonSchema)))
  // of the def a numbered one was numbered after
  const baseOf = (name: string) => nameOf(names.numbered.get(defName(name)), schemas[name])

  const merged = new Map<string, string>()

  for (const group of groups) {
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a copy
    const [kept, ...others] = [...group].sort(preference)
    // a component of `base` equal to them, of the name they were numbered after (`Role` of the
    // parameter form `RoleParam`), as the stock generator reuses one of the name it is given
    const base = baseOf(kept!)
    const into =
      base !== undefined &&
      reserved.has(base) &&
      stringifyJSON(schemas[base]) === stringifyJSON(schemas[kept!])
        ? base
        : undefined
    for (const name of into ? group : others) {
      merged.set(name, into ?? kept!)
    }
  }

  const renamed = new Map<string, string>()
  // the component holding each name, by its own name
  const holders = new Map(
    Object.keys(schemas)
      .filter((name) => !merged.has(name))
      .map((name) => [name, name]),
  )
  const taken = (name: string) => holders.has(name) || reserved.has(name)
  const move = (name: string, to: string) => {
    const from = renamed.get(name) ?? name
    if (holders.get(from) === name) {
      holders.delete(from)
    }
    holders.set(to, name)
    renamed.set(name, to)
  }
  const renamable = candidates.filter(
    (n) => !merged.has(n) && !directed.has(n) && names.numbered.has(defName(n)),
  )
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a copy
  renamable.sort(preference)

  // a name freed by a component renamed in turn may be taken by another one
  for (let moved = true; moved;) {
    moved = false

    for (const name of renamable) {
      const base = baseOf(name)!

      if ((renamed.get(name) ?? name) === base) {
        continue
      }

      if (!taken(base)) {
        move(name, base)
        moved = true
        continue
      }

      // the form of a type as a parameter, by its own name still, yields it to a type of that name,
      // and takes its type's name when free, else a numbered one, and so does a def named after an
      // alias its type lost, to a def of a declared type, whichever was given the name first
      const holder = holders.get(base)
      if (
        holder !== undefined &&
        holder !== name &&
        !reserved.has(holder) &&
        (names.parameters?.has(defName(holder)) ||
          (names.aliased?.has(defName(holder)) && !names.aliased.has(defName(name)))) &&
        !renamed.has(holder)
      ) {
        holders.delete(base)
        move(name, base)
        move(holder, getFreeName(base, taken, baseOf(holder)))
        moved = true
      }
    }
  }

  const resolve = (name: string) => {
    const kept = merged.get(name) ?? name
    return renamed.get(kept) ?? kept
  }

  const siblings = [...directed].filter(([name, { sibling }]) => sibling && !merged.has(name))
  for (const [name] of siblings) {
    holders.delete(name)
  }
  for (const [name, { base, direction }] of siblings) {
    const to = `${resolve(base)}${direction}`
    if (to !== name && (!taken(to) || taken(name))) {
      move(name, getFreeName(to, taken))
    } else {
      holders.set(name, name)
    }
  }

  for (const [name, { base, sibling }] of directed) {
    const opposite = `${base}${name.endsWith('Input') ? 'Output' : 'Input'}`
    if (!sibling && !merged.has(name) && !taken(opposite)) {
      move(name, getFreeName(base, taken))
    }
  }

  if (!merged.size && !renamed.size) {
    return
  }

  const entries = Object.entries(schemas)
  for (const name of Object.keys(schemas)) {
    delete schemas[name]
  }
  for (const [name, schema] of entries) {
    if (!merged.has(name)) {
      setOwn(schemas, resolve(name), mapComponentRefs(schema as JsonSchema, resolve))
    }
  }

  // the other schemas of the document, in the objects it shares with these copies
  const {
    components: { schemas: _, ...components },
    ...others
  } = document
  rewriteSchemaRefs([components, others], resolve)
}

/**
 * The first of `first` and the names numbered after `base` (`Page2`, `Page_1_2` of `Page_1`, so it
 * does not collide with `Page_12`) that is not taken.
 */
export function getFreeName(
  base: string,
  taken: (name: string) => boolean,
  first: string = base,
): string {
  const separator = /\d$/u.test(base) ? '_' : ''
  let name = first
  for (let i = 2; taken(name); i++) {
    name = `${base}${separator}${i}`
  }
  return name
}

/**
 * The classes of names of the same shape that refer to names of the same classes in turn, refined
 * from the classes of their shapes until they no longer split.
 */
function getEquivalenceClasses(
  shapes: ReadonlyMap<string, string>,
  refs: ReadonlyMap<string, readonly string[]>,
): string[][] {
  let classes: ReadonlyMap<string, string> = shapes

  for (let count = 0; ;) {
    const ids = new Map<string, string>()
    const next = new Map<string, string>()

    for (const [name, id] of classes) {
      const key = [id, ...refs.get(name)!.map((r) => classes.get(r))].join('\u0000')
      if (!ids.has(key)) {
        ids.set(key, String(ids.size))
      }
      next.set(name, ids.get(key)!)
    }

    classes = next
    if (ids.size === count) {
      break
    }
    count = ids.size
  }

  const members = new Map<string, string[]>()
  for (const [name, id] of classes) {
    members.set(id, [...(members.get(id) ?? []), name])
  }
  return [...members.values()]
}

/**
 * Replaces characters OpenAPI does not allow in component keys with `_`, as the stock generator does.
 */
function toValidComponentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/gu, '_') || '_'
}

function toValidSet(names: ReadonlySet<string> | undefined): ReadonlySet<string> | undefined {
  return names && new Set([...names].map(toValidComponentName))
}

function toValidMap(
  names: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> | undefined {
  return (
    names &&
    new Map(
      [...names].map(([name, base]) => [toValidComponentName(name), toValidComponentName(base)]),
    )
  )
}

function toValidDefNameRecord(record: DefNameRecord): DefNameRecord {
  return {
    used: toValidSet(record.used)!,
    numbered: toValidMap(record.numbered)!,
    modes: toValidMap(record.modes),
    parameters: toValidSet(record.parameters),
    aliased: toValidSet(record.aliased),
  }
}

/**
 * A schema whose refs to components are mapped by the names of the components, also in
 * discriminator mappings, not in data (`examples`, `default`, `const`).
 */
function mapComponentRefs(schema: JsonSchema, resolve: (name: string) => string): JsonSchema {
  return mapJsonSchemaRefs(schema, (ref) => {
    if (!ref.startsWith(COMPONENTS_REF_PREFIX)) {
      return ref
    }

    const name = decodeJsonPointerSegment(ref.slice(COMPONENTS_REF_PREFIX.length))
    const resolved = resolve(name)
    return resolved === name ? ref : COMPONENTS_REF_PREFIX + encodeJsonPointerSegment(resolved)
  })
}

/**
 * Maps the refs to components of the schemas a part of a document holds, in place: of parameters,
 * headers, and media types, not in examples or extensions.
 */
function rewriteSchemaRefs(value: unknown, resolve: (name: string) => string): void {
  if (typeof value !== 'object' || value === null) {
    return
  }

  for (const [key, item] of Object.entries(value)) {
    if (key === 'schema' || key === 'itemSchema') {
      setOwn(value, key, mapComponentRefs(item as JsonSchema, resolve))
    } else if (key !== 'example' && key !== 'examples' && !key.startsWith('x-')) {
      rewriteSchemaRefs(item, resolve)
    }
  }
}

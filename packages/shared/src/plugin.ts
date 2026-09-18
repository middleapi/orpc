export interface OrderablePlugin {
  /** Unique name of the plugin, used for ordering and identification. */
  name: string

  /** Plugins this plugin should execute before. */
  before?: string[] | undefined

  /** Plugins this plugin should execute after. */
  after?: string[] | undefined
}

/**
 * Sorts plugins based on their `before` and `after` dependencies.
 *
 * The sort is stable: plugins the constraints leave unordered keep their original relative
 * order, so where a plugin lands never depends on where an unrelated plugin sits in the array.
 */
export function sortPlugins<T extends OrderablePlugin>(
  plugins: T[],
): T[] {
  const pluginCount = plugins.length

  const pluginIdToIndices = new Map<string, number[]>()

  for (let i = 0; i < pluginCount; i++) {
    const plugin = plugins[i]!

    const indices = pluginIdToIndices.get(plugin.name)
    if (indices === undefined) {
      pluginIdToIndices.set(plugin.name, [i])
    }
    else {
      indices.push(i)
    }
  }

  /** Every index that must be emitted before this one, shrinking as they are emitted. */
  const dependencies: Array<Set<number>> = Array.from({ length: pluginCount }, () => new Set<number>())
  /** Every index waiting on this one. */
  const dependents: Array<number[]> = Array.from({ length: pluginCount }, () => [])

  function addEdge(before: number, after: number): void {
    if (dependencies[after]!.has(before)) {
      return
    }

    dependencies[after]!.add(before)
    dependents[before]!.push(after)
  }

  for (let i = 0; i < pluginCount; i++) {
    const plugin = plugins[i]!

    for (const beforeId of plugin.before ?? []) {
      for (const beforeIndex of pluginIdToIndices.get(beforeId) ?? []) {
        addEdge(i, beforeIndex)
      }
    }

    for (const afterId of plugin.after ?? []) {
      for (const afterIndex of pluginIdToIndices.get(afterId) ?? []) {
        addEdge(afterIndex, i)
      }
    }
  }

  /** Insertion order is ascending and deletions preserve it, so iterating yields the lowest index first. */
  const remaining = new Set<number>(Array.from({ length: pluginCount }, (_, i) => i))
  const sorted: T[] = []

  while (sorted.length < pluginCount) {
    let next: number | undefined

    for (const index of remaining) {
      if (dependencies[index]!.size === 0) {
        next = index
        break
      }
    }

    if (next === undefined) {
      const pluginId = plugins[findCycleMember(dependencies, remaining)]?.name ?? 'unknown'
      throw new Error(`Circular dependency detected involving plugin "${pluginId}"`)
    }

    remaining.delete(next)
    sorted.push(plugins[next]!)

    for (const dependent of dependents[next]!) {
      dependencies[dependent]!.delete(next)
    }
  }

  return sorted
}

/**
 * Every plugin left unready still has an unmet dependency, so walking dependency edges from
 * any of them always reaches a cycle.
 */
function findCycleMember(dependencies: Array<Set<number>>, remaining: Set<number>): number {
  const seen = new Set<number>()
  let current = remaining.values().next().value!

  while (!seen.has(current)) {
    seen.add(current)

    let next: number | undefined
    for (const dependency of dependencies[current]!) {
      if (remaining.has(dependency)) {
        next = dependency
        break
      }
    }

    if (next === undefined) {
      break
    }

    current = next
  }

  return current
}

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

  const graph: Array<Set<number>> = Array.from(
    { length: pluginCount },
    () => new Set<number>(),
  )

  for (let i = 0; i < pluginCount; i++) {
    const plugin = plugins[i]!

    const beforeList = plugin.before
    if (beforeList !== undefined) {
      for (const beforeId of beforeList) {
        const beforeIndices = pluginIdToIndices.get(beforeId)
        if (beforeIndices === undefined)
          continue

        for (const beforeIndex of beforeIndices) {
          const beforeGraph = graph[beforeIndex]
          if (beforeGraph !== undefined) {
            beforeGraph.add(i)
          }
        }
      }
    }

    const afterList = plugin.after
    if (afterList !== undefined) {
      const currentGraph = graph[i]
      if (currentGraph !== undefined) {
        for (const afterId of afterList) {
          const afterIndices = pluginIdToIndices.get(afterId)
          if (afterIndices === undefined)
            continue

          for (const afterIndex of afterIndices) {
            currentGraph.add(afterIndex)
          }
        }
      }
    }
  }

  const sorted: T[] = []
  const visiting = new Set<number>()
  const visited = new Set<number>()

  function visit(index: number): void {
    if (visited.has(index))
      return

    if (visiting.has(index)) {
      const plugin = plugins[index]
      const pluginId = plugin !== undefined ? plugin.name : 'unknown'
      throw new Error(`Circular dependency detected involving plugin "${pluginId}"`)
    }

    visiting.add(index)

    const deps = graph[index]
    if (deps !== undefined) {
      for (const depIndex of deps) {
        visit(depIndex)
      }
    }

    visiting.delete(index)
    visited.add(index)

    const plugin = plugins[index]
    if (plugin !== undefined) {
      sorted.push(plugin)
    }
  }

  for (let i = 0; i < pluginCount; i++) {
    visit(i)
  }

  return sorted
}

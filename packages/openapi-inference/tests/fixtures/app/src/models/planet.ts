/** A planet in the solar system */
export interface Planet {
  /** Unique id */
  id: number
  name: string
  description?: string
  discoveredAt: Date
  moons: Planet[]
}

export type PlanetKind = 'rocky' | 'gas'

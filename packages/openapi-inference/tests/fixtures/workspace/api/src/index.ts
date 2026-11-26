import type { Planet } from '@acme/db'

/** Models of a workspace package, linked into `node_modules` like pnpm does */
export interface Planets {
  planets: Planet[]
}

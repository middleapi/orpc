import type { InferSelectModel } from 'fake-orm'

import type { crews } from './crew-tables'

// an alias only a file the router does not import declares
export type Crew = InferSelectModel<typeof crews>

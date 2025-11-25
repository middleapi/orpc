import type { EventMeta } from '@orpc/standard-server'

export interface SerializedMessage {
  data: unknown
  meta?: EventMeta
}

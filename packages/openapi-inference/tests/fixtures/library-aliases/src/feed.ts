import type { PostRecord } from './models'

export interface Feed {
  latest: PostRecord | null
}

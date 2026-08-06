import ads from './ads'

export interface AdSponsor {
  name: string
  /** Tagline shown under the name. */
  description: string
  /** Square icon URL (GitHub avatar works) or inline data URI. */
  logo: string
  href: string
  /** Relative appearance frequency (normalized to > 0 by the sync script). */
  weight: number
}

export function adPool(): AdSponsor[] {
  return ads
}

// The GitHub Sponsors wall behind the landing page. Paid ad slots are a
// separate concern and live in ads.ts.
import sponsors from './sponsors'

export interface Sponsor {
  /** Display name, already falling back to the GitHub login when unset. */
  name: string
  login: string
  avatar: string
  /** Sponsor's own link, tracking params already baked in upstream. */
  link: string
  /** Extra rel tokens for the link (e.g. `sponsored`); may be empty. */
  rel: string
  /** GitHub Sponsors tier label, e.g. `Special Sponsor`. */
  tierTitle: string
  /** Higher is a bigger tier; `0` marks a lapsed sponsor. */
  tierLevel: number
}

export interface SponsorTier {
  title: string
  level: number
  sponsors: Sponsor[]
}

// Annotated, not cast: if the sync script ever changes the generated shape this
// has to fail type checking rather than quietly lie about it.
const allSponsors: Sponsor[] = sponsors

/**
 * Current sponsors grouped by tier, biggest tier first. The generated file is
 * already sorted, so grouping preserves that order within each tier.
 */
export function sponsorTiers(): SponsorTier[] {
  const tiers: SponsorTier[] = []

  for (const sponsor of allSponsors) {
    if (sponsor.tierLevel <= 0) {
      continue
    }

    const tier = tiers.at(-1)

    if (tier?.level === sponsor.tierLevel) {
      tier.sponsors.push(sponsor)
      continue
    }

    tiers.push({ title: sponsor.tierTitle, level: sponsor.tierLevel, sponsors: [sponsor] })
  }

  return tiers
}

/** Sponsors whose sponsorship has ended, still worth thanking. */
export function pastSponsors(): Sponsor[] {
  return allSponsors.filter(sponsor => sponsor.tierLevel <= 0)
}

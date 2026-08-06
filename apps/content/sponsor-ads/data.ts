export interface AdSponsor {
  name: string
  /** Tagline shown under the name. */
  description: string
  /** Square icon URL (GitHub avatar works) or inline data URI. */
  logo: string
  href: string
}

const MEGAPHONE_LOGO
  = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238b8b8b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m3 11 18-5v12L3 14v-3z%22/%3E%3Cpath d=%22M11.6 16.8a3 3 0 1 1-5.8-1.6%22/%3E%3C/svg%3E'

export const AD_SPONSORS: AdSponsor[] = [
  {
    name: 'ScreenshotOne',
    description: 'The screenshot API for developers',
    logo: 'https://avatars.githubusercontent.com/u/97035603?v=4',
    href: 'https://screenshotone.com',
  },
  {
    name: 'Misskey',
    description: 'Open source, federated social platform',
    logo: 'https://avatars.githubusercontent.com/u/37681609?v=4',
    href: 'https://misskey.io',
  },
]

export const PROMO_CARD: AdSponsor = {
  name: 'Your product here',
  description: 'Reach oRPC developers — become a sponsor',
  logo: MEGAPHONE_LOGO,
  href: 'https://github.com/sponsors/dinwwwh',
}

export function adPool(): AdSponsor[] {
  return AD_SPONSORS.length < 4 ? [...AD_SPONSORS, PROMO_CARD] : AD_SPONSORS
}

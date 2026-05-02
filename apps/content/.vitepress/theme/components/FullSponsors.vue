<script lang="ts" setup>
import { computed } from 'vue'
import { sponsors } from '../sponsors'

const activeSponsors = computed(() =>
  sponsors.filter(s => s.tierLevel > 0 && s.amount > 0),
)

const pastSponsors = computed(() =>
  sponsors.filter(s => s.tierLevel <= 0 || s.amount <= 0),
)

const tierGroups = computed(() => {
  const grouped = new Map<number, typeof sponsors>()

  for (const sponsor of activeSponsors.value) {
    const group = grouped.get(sponsor.tierLevel)
    if (group) {
      group.push(sponsor)
    }
    else {
      grouped.set(sponsor.tierLevel, [sponsor])
    }
  }

  const tierLevels = [...grouped.keys()].sort((a, b) => b - a)

  return tierLevels.map((level) => {
    const tierSponsors = grouped.get(level)!
    const rank = tierLevels.indexOf(level)
    const columns = [3, 4, 5, 6, 7, 8]
    const cols = columns[Math.min(rank, columns.length - 1)] ?? 6

    return {
      level,
      title: tierSponsors[0]?.tierTitle ?? `Tier ${level}`,
      sponsors: tierSponsors,
      cols,
    }
  })
})
</script>

<template>
  <div class="full-sponsors-container">
    <h2 class="sponsored-by">
      Sponsored by
    </h2>
    <p class="sponsor-cta">
      If you find oRPC valuable and would like to support its development:
      <a href="https://github.com/sponsors/dinwwwh" target="_blank" rel="noopener">GitHub Sponsors</a>
    </p>

    <div v-for="tier in tierGroups" :key="tier.level" class="tier-section">
      <h3 class="tier-title">
        {{ tier.title }}
      </h3>
      <div class="tier-grid" :style="{ '--cols': tier.cols }">
        <div
          v-for="sponsor in tier.sponsors"
          :key="sponsor.login"
          class="tier-grid-item"
        >
          <a
            :href="sponsor.link"
            target="_blank"
            rel="noopener"
            :title="sponsor.name || sponsor.login"
            class="sponsor-link"
          >
            <img
              :src="sponsor.avatar"
              :alt="sponsor.name || sponsor.login"
              loading="lazy"
            >
            <span class="sponsor-name">{{ sponsor.name || sponsor.login }}</span>
          </a>
        </div>
      </div>
    </div>

    <div v-if="pastSponsors.length > 0" class="tier-section">
      <h3 class="tier-title">
        Past Sponsors
      </h3>
      <div class="past-sponsors">
        <a
          v-for="sponsor in pastSponsors"
          :key="sponsor.login"
          :href="sponsor.link"
          target="_blank"
          rel="noopener"
          :title="sponsor.name || sponsor.login"
          class="past-sponsor-link"
        >
          <img
            :src="sponsor.avatar"
            :alt="sponsor.name || sponsor.login"
            class="past-sponsor-avatar"
            loading="lazy"
          >
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.full-sponsors-container {
  margin-top: 40px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  max-width: 768px;
  margin-left: auto;
  margin-right: auto;
}

.sponsored-by {
  opacity: 0.8;
  margin: 48px 0 8px;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 24px;
  letter-spacing: -0.02em;
  line-height: 32px;
  font-size: 24px;
}

.sponsor-cta {
  margin-bottom: 24px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.sponsor-cta a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
}

.tier-section {
  width: 100%;
  margin-bottom: 16px;
}

.tier-title {
  font-size: 18px;
  font-weight: 600;
  margin-top: 16px;
  margin-bottom: 8px;
  color: var(--vp-c-text-1);
}

.tier-grid {
  display: grid;
  grid-template-columns: repeat(min(var(--cols, 6), 2), 1fr);
}

.tier-grid-item {
  display: flex;
  justify-content: center;
  align-items: start;
  padding: 12px;
  text-align: center;
  border: 1px solid var(--vp-c-divider);
  margin: -1px 0 0 -1px;
}

.tier-grid-item img {
  width: 100%;
  height: auto;
}

@media (min-width: 640px) {
  .tier-grid {
    grid-template-columns: repeat(min(var(--cols, 6), 3), 1fr);
  }
}

@media (min-width: 768px) {
  .tier-grid {
    grid-template-columns: repeat(var(--cols, 6), 1fr);
  }
}

.sponsor-link {
  text-decoration: none;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
}

.sponsor-link:hover {
  opacity: 0.8;
}

.sponsor-name {
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.past-sponsors {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
}

.past-sponsor-link {
  opacity: 0.7;
  transition: opacity 0.2s;
}

.past-sponsor-link:hover {
  opacity: 1;
}

.past-sponsor-avatar {
  width: 100%;
  height: auto;
}

@media (min-width: 640px) {
  .past-sponsors {
    grid-template-columns: repeat(12, 1fr);
  }
}

@media (min-width: 768px) {
  .past-sponsors {
    grid-template-columns: repeat(18, 1fr);
  }
}
</style>

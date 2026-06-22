<script setup lang="ts">
import { useElementSize, useWindowScroll, useWindowSize } from '@vueuse/core'
import { computed, ref, watchEffect } from 'vue'

const container = ref<HTMLElement>()
const { y } = useWindowScroll()
const { width } = useWindowSize()
const { height } = useElementSize(container)
const layoutTopHeight = computed(() => Math.max(0, height.value - y.value))

watchEffect(() => {
  if (typeof window === 'undefined' || width.value < 960) {
    return
  }

  document.documentElement.style.setProperty('--vp-layout-top-height', `${layoutTopHeight.value}px`)
})

const THREE_DAYS_MS = 1000 * 60 * 60 * 24 * 3

const BANNER_STORAGE_KEYS = {
  beta: `banner-beta-dismissed-at`,
  sponsor: `banner-sponsor-dismissed-at`,
} as const

type BannerKey = keyof typeof BANNER_STORAGE_KEYS

function shouldShowBanner(key: BannerKey) {
  if (typeof window === 'undefined') {
    return true
  }

  return (Number(window.localStorage.getItem(BANNER_STORAGE_KEYS[key])) || 0) + THREE_DAYS_MS < Date.now()
}

const showBeta = ref(shouldShowBanner(`beta`))
const showSponsor = ref(shouldShowBanner(`sponsor`))
const hasVisibleBanners = computed(() => showBeta.value || showSponsor.value)

function dismissBanner(key: BannerKey) {
  if (typeof window === 'undefined') {
    return
  }

  if (key === `beta`) {
    showBeta.value = false
  }
  else {
    showSponsor.value = false
  }

  window.localStorage.setItem(BANNER_STORAGE_KEYS[key], Date.now().toString())
}
</script>

<template>
  <div v-show="hasVisibleBanners" ref="container" class="banner-container">
    <div v-show="showBeta" class="banner-row banner-beta">
      <div class="banner">
        <div class="banner-content">
          <div class="banner-text">
            oRPC v2 is now public beta -
          </div>

          <a class="banner-action" href="https://v2.orpc.dev" target="_blank" rel="noopener">
            Learn More
          </a>
        </div>

        <button type="button" class="banner-close" aria-label="Dismiss oRPC v2 beta banner" @click="dismissBanner('beta')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path
              d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
            />
          </svg>
        </button>
      </div>
    </div>

    <div v-show="showSponsor" class="banner-row banner-sponsor">
      <div class="banner">
        <div class="banner-content">
          <div class="banner-text">
            The screenshot API <span class="banner-helper">for developers</span> -
          </div>

          <a class="banner-action" href="https://screenshotone.com/?ref=orpc" target="_blank" rel="noopener">
            Try ScreenshotOne
          </a>
        </div>

        <button type="button" class="banner-close" aria-label="Dismiss sponsor banner" @click="dismissBanner('sponsor')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path
              d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
            />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style>
@media (min-width: 960px) {
  html {
    --vp-layout-top-height: 52px;
  }
}

.banner-container {
  color: var(--vp-c-white);
}

.banner-row {
  width: 100%;
}

.banner {
  padding: 1px 40px 1px 24px;
  max-width: calc(var(--vp-layout-max-width) - 64px);
  position: relative;
  margin-right: auto;
  margin-left: auto;
  z-index: var(--vp-z-index-layout-top);
  display: flex;
  justify-content: center;
  align-items: center;
}

.banner-beta {
  background: rgba(255, 0, 189, 0.8);
}

.banner-sponsor {
  background: rgb(79, 70, 229);
}

.banner-content {
  flex: 1 1 auto;
  display: flex;
  justify-content: center;
  align-items: center;

  font-size: 14px;
}

.banner-text {
  font-weight: 600;
}

.banner-helper {
  display: none;
}

@media (min-width: 768px) {
  .banner-helper {
    display: inline;
  }
}

.banner-action {
  margin-left: 2px;
  font-weight: 700;
  text-decoration: underline;
}

.banner-action:hover {
  transition: filter 0.2s ease;
  filter: brightness(1.1);
}

.banner-close {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}

.banner-close svg {
  width: 20px;
  height: 20px;
  fill: var(--vp-c-white);
}
</style>

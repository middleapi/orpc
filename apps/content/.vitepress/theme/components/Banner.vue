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

const show = ref(typeof window === 'undefined' || (Number(window.localStorage.getItem(`banner-dismissed-at`)) || 0) + THREE_DAYS_MS < Date.now())

function dismissBanner() {
  if (typeof window === 'undefined') {
    return
  }

  show.value = false
  window.localStorage.setItem(`banner-dismissed-at`, Date.now().toString())
}
</script>

<template>
  <div v-show="show" ref="container" class="banner-container">
    <div class="banner">
      <div class="banner-content">
        <div class="banner-text">
          The screenshot API <span class="banner-helper">for developers</span> -
        </div>

        <a class="banner-action" href="https://screenshotone.com/?ref=orpc" target="_blank" rel="noopener">
          Try ScreenshotOne
        </a>
      </div>

      <button type="button" class="banner-close" @click="dismissBanner">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path
            d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style>
@media (min-width: 960px) {
  html {
    --vp-layout-top-height: 26px;
  }
}

.banner-container {
  background: rgb(79, 70, 229);
  color: var(--vp-c-white);
}

.banner {
  padding: 1px 24px;
  max-width: calc(var(--vp-layout-max-width) - 64px);
  position: relative;
  margin-right: auto;
  margin-left: auto;
  z-index: var(--vp-z-index-layout-top);
  display: flex;
  justify-content: center;
  align-items: center;
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
}

.banner-close svg {
  width: 20px;
  height: 20px;
  fill: var(--vp-c-white);
}
</style>

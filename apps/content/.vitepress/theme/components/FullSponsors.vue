<template>
  <div :class="$style['full-sponsors-container']">
    <h2 :class="$style['sponsored-by']">
      Sponsored by
    </h2>
    <p :class="$style['sponsor-cta']">
      If you find oRPC valuable and would like to support its development:
      <a href="https://github.com/sponsors/dinwwwh" target="_blank" rel="noopener">GitHub Sponsors</a>
    </p>

    <!--
      The wall is generated upstream (middleapi/static) and served as a single
      SVG, so nothing here needs syncing. Links baked into the SVG are inert
      inside an <img>, hence the wrapping anchor to the interactive preview.
    -->
    <a
      :class="$style['sponsors-wall']"
      href="https://htmlpreview.github.io/?https://github.com/middleapi/static/blob/main/sponsors.svg"
      target="_blank"
      rel="noopener"
    >
      <img
        src="https://cdn.jsdelivr.net/gh/middleapi/static/sponsors.svg"
        alt="oRPC sponsors"
        loading="lazy"
      >
    </a>
  </div>
</template>

<style module>
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

.sponsors-wall {
  width: 100%;
}

.sponsors-wall img {
  width: 100%;
  height: auto;
}
</style>

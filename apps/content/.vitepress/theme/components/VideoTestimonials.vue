<script lang="ts" setup>
const videos = [
  {
    id: 'vl-Iir69lUA',
    title: 'I Switched from tRPC to oRPC (Here\'s Why)',
  },
  {
    id: '_oHJUxkAM1w',
    title: 'tRPC vs oRPC: Typesafe API battle!',
  },
  {
    id: 'uogRJKpAkUM',
    title: 'STOP Using tRPC, Try oRPC Instead (It\'s a Game-Changer)',
  },
]
</script>

<template>
  <div :class="$style['container']">
    <div :class="$style['items']">
      <div v-for="video in videos" :key="video.id" :class="$style['item']">
        <div :class="$style['video-wrapper']">
          <iframe
            :src="`https://www.youtube.com/embed/${video.id}?rel=0&modestbranding=1`"
            :title="video.title"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style module>
.container {
  margin-top: 16px;
}

.items {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.video-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 12px;
}

.video-wrapper iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
}

@media (min-width: 640px) {
  .items {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 768px) {
  .items {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>

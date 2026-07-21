<script setup>
import { RouterView } from 'vue-router';
</script>

<template>
  <RouterView />
</template>

<style lang="scss">
:root,
html,
body,
#app,
button,
input,
textarea,
select {
  font-family: "Noto Sans JP", sans-serif;
}

:root {
  --el-font-family: "Noto Sans JP", sans-serif;
  font-size: var(--font-size-base);
}

html,
body {
  height: 100%;
}

body {
  margin: 0;
  font-size: var(--font-size-base);
  line-height: var(--line-height-base);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
#app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>

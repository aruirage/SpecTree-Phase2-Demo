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
}

body {
  margin: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>

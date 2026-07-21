<template>
  <div class="not-found">
    <h1>404</h1>
    <p>お探しのページは見つかりませんでした。</p>
    <router-link to="/">トップページへ戻る</router-link>
  </div>
</template>

<style scoped lang="scss">
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background-color: #f0f2f5;
  color: #333;

  h1 {
    font-size: 60px;
    margin-bottom: 20px;
  }

  p {
    font-size: 20px;
    margin-bottom: 30px;
  }

  a {
    color: #409eff;
    text-decoration: none;
    font-size: 18px;
    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
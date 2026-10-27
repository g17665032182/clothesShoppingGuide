<template>
  <main class="page">
    <header class="topbar">
      <RouterLink class="brand" to="/" aria-label="服装购物指南首页">
        <span class="brand-mark" aria-hidden="true">衣</span>
        <span>服装购物指南</span>
      </RouterLink>
      <nav aria-label="主导航">
        <RouterLink class="nav-link" to="/">首页</RouterLink>
      </nav>
    </header>

    <section class="content">
      <p class="eyebrow">CLOTHES SHOPPING GUIDE</p>
      <h1>找到更适合自己的穿着选择</h1>
      <p class="intro">从了解自己的需求开始，逐步探索服装与搭配。</p>
      <div class="status">
        <span class="status-dot" aria-hidden="true"></span>
        前端基础已就绪
      </div>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f7f7f4;
  color: #252923;
}

.topbar {
  display: flex;
  min-height: 68px;
  align-items: center;
  justify-content: space-between;
  padding: 0 6vw;
  border-bottom: 1px solid #e4e6df;
  background: #fff;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: inherit;
  font-size: 15px;
  font-weight: 650;
  text-decoration: none;
}

.brand-mark {
  display: grid;
  width: 32px;
  aspect-ratio: 1;
  place-items: center;
  border-radius: 7px;
  background: #315c48;
  color: #fff;
  font-size: 16px;
}

.nav-link {
  color: #315c48;
  font-size: 14px;
  text-decoration: none;
}

.content {
  width: min(100% - 40px, 920px);
  margin: 0 auto;
  padding: clamp(88px, 15vh, 160px) 0 100px;
}

.eyebrow {
  margin: 0 0 18px;
  color: #66736a;
  font-size: 12px;
  font-weight: 650;
}

h1 {
  max-width: 680px;
  margin: 0;
  font-size: clamp(36px, 6vw, 64px);
  font-weight: 650;
  line-height: 1.16;
}

.intro {
  margin: 22px 0 0;
  color: #626a63;
  font-size: 17px;
  line-height: 1.7;
}

.status {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 9px;
  margin-top: 44px;
  padding: 10px 13px;
  border: 1px solid #dce5dc;
  border-radius: 6px;
  background: #fff;
  color: #3d5e48;
  font-size: 13px;
}

.status-dot {
  width: 8px;
  aspect-ratio: 1;
  border-radius: 50%;
  background: #56a36a;
}

@media (max-width: 600px) {
  .topbar {
    padding: 0 20px;
  }

  .content {
    padding-top: 96px;
  }
}
</style>

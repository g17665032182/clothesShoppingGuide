<script setup lang="ts">
import { Check, Shirt } from '@lucide/vue';
import { Separator } from '@/components/ui/separator';
</script>

<template>
  <aside
    class="flex flex-col justify-between gap-10 rounded-2xl bg-muted/50 p-6 sm:p-10 lg:min-h-[620px] lg:p-12"
  >
    <div class="flex flex-col gap-8">
      <div class="flex items-center gap-3">
        <span
          class="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"
        >
          <Shirt aria-hidden="true" class="size-5" />
        </span>
        <div>
          <p class="text-sm font-semibold text-foreground">衣橱指南</p>
          <p class="text-xs text-muted-foreground">Clothes Shopping Guide</p>
        </div>
      </div>

      <div class="flex max-w-xl flex-col gap-5">
        <p
          class="text-xs font-semibold tracking-[0.18em] text-muted-foreground"
        >
          YOUR EVERYDAY STYLE COMPANION
        </p>
        <h1
          class="max-w-lg text-4xl leading-tight font-semibold tracking-tight text-foreground sm:text-5xl"
        >
          从认识自己的风格开始。
        </h1>
        <p class="max-w-md text-base leading-7 text-muted-foreground">
          整理穿衣需求，记录真实偏好，让每一次挑选都更接近适合自己的答案。
        </p>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <Separator />
      <ul
        class="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3 lg:grid-cols-1"
      >
        <li class="flex items-center gap-2">
          <Check aria-hidden="true" class="size-4 text-primary" />
          记录你的穿衣偏好
        </li>
        <li class="flex items-center gap-2">
          <Check aria-hidden="true" class="size-4 text-primary" />
          获得更具体的搭配建议
        </li>
        <li class="flex items-center gap-2">
          <Check aria-hidden="true" class="size-4 text-primary" />
          在自己的节奏里探索衣橱
        </li>
      </ul>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ArrowUpRight, Globe } from '@lucide/vue';
import type { ChatSource } from '@/api/types/chat';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';

const props = defineProps<{ sources: ChatSource[] }>();
const links = computed(() =>
  props.sources.flatMap((source) => {
    try {
      const url = new URL(source.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      )
        return [];
      return [
        {
          id: source.id,
          title: source.title || url.hostname,
          url: url.href,
          hostname: url.hostname,
        },
      ];
    } catch {
      return [];
    }
  }),
);
</script>

<template>
  <Trace v-if="links.length" class="min-w-0 max-w-full">
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon><Globe /></TraceIcon>
          <TraceTitle>参考了 {{ links.length }} 个来源</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          <a
            v-for="source in links"
            :key="source.id"
            :href="source.url"
            :title="`${source.title} · ${source.hostname}`"
            target="_blank"
            rel="noopener noreferrer"
          >
            <TraceLine>
              <TraceTitle>
                {{ source.title }} · {{ source.hostname }}
                <span class="sr-only">（在新标签页打开）</span>
              </TraceTitle>
              <TraceIcon><ArrowUpRight /></TraceIcon>
            </TraceLine>
          </a>
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>
</template>

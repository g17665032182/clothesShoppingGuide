<script setup lang="ts">
import { CloudSun, LocateFixed } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { locateWeatherCity } from '@/api/modules/chat-weather';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroupButton } from '@/components/ui/input-group';
import { auth } from '@/lib/auth';

const props = defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ confirm: [city: string] }>();
const open = ref(false);
const city = ref('');
const status = ref<'idle' | 'loading' | 'suggested' | 'unavailable'>('idle');
const fieldId = useId();
const canConfirm = computed(
  () => !props.disabled && city.value.trim().length > 0,
);
let pending: AbortController | undefined;

function resetLocation() {
  pending?.abort();
  pending = undefined;
  city.value = '';
  status.value = 'idle';
}

watch(
  open,
  (value) => {
    if (!value) resetLocation();
  },
  { flush: 'sync' },
);
watch(
  () => auth.state.user?.id,
  () => {
    open.value = false;
  },
);
onBeforeUnmount(resetLocation);

async function requestLocation() {
  const token = auth.state.token;
  if (!token || pending) return;

  const request = new AbortController();
  const originalCity = city.value;
  pending = request;
  status.value = 'loading';
  try {
    const result = await locateWeatherCity(token, request.signal);
    if (request.signal.aborted) return;
    if (result.city) {
      // 用户在定位期间手动填写的内容优先保留。
      if (city.value === originalCity) city.value = result.city;
      status.value = 'suggested';
    } else {
      status.value = 'unavailable';
    }
  } catch {
    if (!request.signal.aborted) status.value = 'unavailable';
  } finally {
    if (pending === request) pending = undefined;
  }
}

function confirmCity() {
  if (!canConfirm.value) return;
  const confirmedCity = city.value.trim();
  open.value = false;
  emit('confirm', confirmedCity);
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <InputGroupButton
        :disabled="disabled"
        aria-label="查询天气"
        size="icon-sm"
        title="查询天气"
        type="button"
        variant="ghost"
      >
        <CloudSun aria-hidden="true" />
      </InputGroupButton>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>查询天气</DialogTitle>
        <DialogDescription>
          可手动输入城市，或同意将本次请求的公网 IP 发送给高德获取城市候选。
        </DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="confirmCity">
        <FieldGroup>
          <Field>
            <FieldLabel :for="fieldId">城市</FieldLabel>
            <Input :id="fieldId" v-model="city" maxlength="100" />
            <FieldDescription role="status">
              <template v-if="status === 'loading'">正在查找城市…</template>
              <template v-else-if="status === 'suggested'">
                请确认城市。你也可以修改后查询。
              </template>
              <template v-else-if="status === 'unavailable'">
                无法按 IP 确定城市，请手动输入。
              </template>
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            :disabled="status === 'loading'"
            type="button"
            variant="outline"
            @click="requestLocation"
          >
            <LocateFixed aria-hidden="true" data-icon="inline-start" />
            同意并定位
          </Button>
          <Button :disabled="!canConfirm" type="submit">确认并查询</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { createForm } from '@formily/core';
import { FormProvider, createSchemaField } from '@formily/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type {
  ChatDynamicForm,
  ChatDynamicFormResult,
  DynamicFormField,
  DynamicFormValues,
} from '@/api/types/chat-dynamic-form';
import {
  DynamicCheckboxField,
  DynamicNumberField,
  DynamicSelectField,
  DynamicTelField,
  DynamicTextField,
  DynamicTextareaField,
} from './formily-fields';

const props = defineProps<{
  form: ChatDynamicForm;
  submitting?: boolean;
  result?: ChatDynamicFormResult | null;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  (event: 'submit', values: DynamicFormValues): void;
  (event: 'cancel'): void;
}>();

const formilyForm = createForm({ validateFirst: true });
const { SchemaField } = createSchemaField({
  components: {
    DynamicTextField,
    DynamicTextareaField,
    DynamicTelField,
    DynamicNumberField,
    DynamicSelectField,
    DynamicCheckboxField,
  },
});

const fieldByKey = new Map(
  props.form.fields.map((field) => [field.key, field]),
);
const schema = computed(() => ({
  type: 'object',
  properties: Object.fromEntries(
    props.form.fields.map((field) => [
      field.key,
      {
        type:
          field.type === 'number'
            ? 'number'
            : field.type === 'checkbox'
              ? 'boolean'
              : 'string',
        title: field.label,
        required: field.required,
        default: field.value ?? undefined,
        'x-component': componentName(field),
        'x-component-props': {
          placeholder: field.placeholder ?? undefined,
          options: field.options ?? [],
        },
      },
    ]),
  ),
}));

const localError = ref('');
const isClosed = computed(() => props.form.status !== 'open');
const submitDisabled = computed(
  () => Boolean(props.submitting) || isClosed.value,
);

function componentName(field: DynamicFormField): string {
  switch (field.type) {
    case 'textarea':
      return 'DynamicTextareaField';
    case 'tel':
      return 'DynamicTelField';
    case 'number':
      return 'DynamicNumberField';
    case 'select':
      return 'DynamicSelectField';
    case 'checkbox':
      return 'DynamicCheckboxField';
    default:
      return 'DynamicTextField';
  }
}

async function submit() {
  localError.value = '';
  try {
    await formilyForm.submit((values) => {
      emit('submit', values as DynamicFormValues);
    });
  } catch {
    localError.value = '请检查表单字段后再提交';
  }
}

onBeforeUnmount(() => {
  formilyForm.reset();
  fieldByKey.clear();
});
</script>

<template>
  <Card class="rounded-md">
    <CardHeader>
      <CardTitle>{{ form.title }}</CardTitle>
      <CardDescription v-if="form.description">
        {{ form.description }}
      </CardDescription>
    </CardHeader>
    <FormProvider :form="formilyForm">
      <CardContent class="grid gap-4">
        <SchemaField :schema="schema" />
        <Alert v-if="localError || errorMessage" variant="destructive">
          <AlertDescription>{{ localError || errorMessage }}</AlertDescription>
        </Alert>
        <Alert v-if="result?.issues.length" variant="destructive">
          <AlertDescription>
            {{ result.issues.map((issue) => issue.message).join('；') }}
          </AlertDescription>
        </Alert>
        <p
          v-if="result?.status === 'submitted'"
          class="text-sm text-muted-foreground"
          role="status"
        >
          信息已提交
        </p>
      </CardContent>
    </FormProvider>
    <CardFooter class="flex justify-end gap-2">
      <Button
        v-if="!isClosed"
        type="button"
        variant="outline"
        :disabled="submitDisabled"
        @click="emit('cancel')"
      >
        取消
      </Button>
      <Button
        v-if="!isClosed"
        type="button"
        :disabled="submitDisabled"
        @click="submit"
      >
        <Spinner v-if="submitting" data-icon="inline-start" />
        {{ form.submitLabel }}
      </Button>
    </CardFooter>
  </Card>
</template>

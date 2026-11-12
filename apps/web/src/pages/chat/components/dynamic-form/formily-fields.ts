import { defineComponent, h, type Component, type PropType } from 'vue';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type { DynamicFormOption } from '@/api/types/chat-dynamic-form';

type Primitive = string | number | boolean | null;

function inputAdapter(type?: string) {
  return defineComponent({
    name: `DynamicForm${type ?? 'Text'}Field`,
    props: {
      value: { type: [String, Number, Boolean] as PropType<Primitive> },
      placeholder: String,
      disabled: Boolean,
    },
    emits: ['change'],
    setup(props, { emit }) {
      return () =>
        h(Input, {
          modelValue:
            typeof props.value === 'boolean' ? '' : (props.value ?? ''),
          type,
          placeholder: props.placeholder,
          disabled: props.disabled,
          'onUpdate:modelValue': (value: string | number) =>
            emit('change', value),
        });
    },
  });
}

export const DynamicTextField = inputAdapter('text');
export const DynamicTelField = inputAdapter('tel');
export const DynamicNumberField = inputAdapter('number');

export const DynamicTextareaField = defineComponent({
  name: 'DynamicFormTextareaField',
  props: {
    value: { type: [String, Number, Boolean] as PropType<Primitive> },
    placeholder: String,
    disabled: Boolean,
  },
  emits: ['change'],
  setup(props, { emit }) {
    return () =>
      h(Textarea, {
        modelValue: typeof props.value === 'boolean' ? '' : (props.value ?? ''),
        placeholder: props.placeholder,
        disabled: props.disabled,
        'onUpdate:modelValue': (value: string | number) =>
          emit('change', value),
      });
  },
});

export const DynamicSelectField = defineComponent({
  name: 'DynamicFormSelectField',
  props: {
    value: { type: [String, Number, Boolean] as PropType<Primitive> },
    options: {
      type: Array as PropType<DynamicFormOption[]>,
      default: () => [],
    },
    disabled: Boolean,
  },
  emits: ['change'],
  setup(props, { emit }) {
    const SelectComponent = NativeSelect as unknown as Component;
    return () =>
      h(
        SelectComponent,
        {
          modelValue:
            typeof props.value === 'boolean' ? '' : (props.value ?? ''),
          disabled: props.disabled,
          class: 'w-full',
          'onUpdate:modelValue': (value: unknown) =>
            emit('change', value as string),
        },
        {
          default: () =>
            props.options.map((option) =>
              h(
                NativeSelectOption,
                {
                  key: option.value,
                  value: option.value,
                },
                () => option.label,
              ),
            ),
        },
      );
  },
});

export const DynamicCheckboxField = defineComponent({
  name: 'DynamicFormCheckboxField',
  props: {
    value: { type: [String, Number, Boolean] as PropType<Primitive> },
    disabled: Boolean,
  },
  emits: ['change'],
  setup(props, { emit }) {
    return () =>
      h(Checkbox, {
        checked: props.value === true,
        disabled: props.disabled,
        'onUpdate:checked': (value: boolean) => emit('change', value),
      });
  },
});

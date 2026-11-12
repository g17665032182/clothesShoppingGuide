import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const DYNAMIC_FORM_STATUSES = [
  'open',
  'submitted',
  'expired',
  'cancelled',
] as const;
export type DynamicFormStatus = (typeof DYNAMIC_FORM_STATUSES)[number];

export const DYNAMIC_FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'tel',
  'number',
  'select',
  'checkbox',
] as const;
export type DynamicFormFieldType = (typeof DYNAMIC_FORM_FIELD_TYPES)[number];

export type DynamicFormOption = {
  value: string;
  label: string;
};

export type DynamicFormField = {
  key: string;
  label: string;
  type: DynamicFormFieldType;
  required: boolean;
  placeholder: string | null;
  options: DynamicFormOption[] | null;
  value?: string | number | boolean | null;
};

export type DynamicFormDefinition = {
  formId: string;
  formKind: string;
  revision: number;
  title: string;
  description: string | null;
  fields: DynamicFormField[];
  submitLabel: string;
  status: DynamicFormStatus;
  expiresAt: string;
};

export type DynamicFormResultReference = {
  kind: string;
  reference: Record<string, string | number | null>;
};

export type DynamicFormResponse = DynamicFormDefinition & {
  result: DynamicFormResultReference | null;
};

export class DynamicFormOptionDto implements DynamicFormOption {
  @ApiProperty()
  public value!: string;

  @ApiProperty()
  public label!: string;
}

export class DynamicFormFieldDto implements DynamicFormField {
  @ApiProperty()
  public key!: string;

  @ApiProperty()
  public label!: string;

  @ApiProperty({ enum: DYNAMIC_FORM_FIELD_TYPES })
  public type!: DynamicFormFieldType;

  @ApiProperty()
  public required!: boolean;

  @ApiPropertyOptional({ nullable: true })
  public placeholder!: string | null;

  @ApiPropertyOptional({
    type: DynamicFormOptionDto,
    isArray: true,
    nullable: true,
  })
  public options!: DynamicFormOption[] | null;

  @ApiPropertyOptional({ nullable: true })
  public value?: string | number | boolean | null;
}

export class DynamicFormResponseDto implements DynamicFormResponse {
  @ApiProperty({ format: 'uuid' })
  public formId!: string;

  @ApiProperty()
  public formKind!: string;

  @ApiProperty()
  public revision!: number;

  @ApiProperty()
  public title!: string;

  @ApiPropertyOptional({ nullable: true })
  public description!: string | null;

  @ApiProperty({ type: DynamicFormFieldDto, isArray: true })
  public fields!: DynamicFormField[];

  @ApiProperty()
  public submitLabel!: string;

  @ApiProperty({ enum: DYNAMIC_FORM_STATUSES })
  public status!: DynamicFormStatus;

  @ApiProperty()
  public expiresAt!: string;

  @ApiPropertyOptional({ nullable: true })
  public result!: DynamicFormResultReference | null;
}

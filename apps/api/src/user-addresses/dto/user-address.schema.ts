import { z } from 'zod';

const recipientNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\u0000-\u001f\u007f]*$/u);
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?\d{6,20}$/u);
const addressSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[^\u0000-\u001f\u007f]*$/u);
const labelSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^\u0000-\u001f\u007f]*$/u)
  .nullable()
  .optional();

export const addressIdSchema = z.strictObject({ id: z.uuid() });
export const listUserAddressesQuerySchema = z.strictObject({
  page: z.coerce.number().int().safe().min(1).default(1),
  pageSize: z.coerce.number().int().safe().min(1).max(100).default(20),
});
export const createUserAddressSchema = z.strictObject({
  requestKey: z.uuid(),
  recipientName: recipientNameSchema,
  phone: phoneSchema,
  address: addressSchema,
  label: labelSchema,
  isDefault: z.boolean().default(false),
});
export const updateUserAddressSchema = z
  .strictObject({
    recipientName: recipientNameSchema.optional(),
    phone: phoneSchema.optional(),
    address: addressSchema.optional(),
    label: labelSchema,
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export type AddressIdInput = z.output<typeof addressIdSchema>;
export type ListUserAddressesQuery = z.output<
  typeof listUserAddressesQuerySchema
>;
export type CreateUserAddressInput = z.output<typeof createUserAddressSchema>;
export type UpdateUserAddressInput = z.output<typeof updateUserAddressSchema>;

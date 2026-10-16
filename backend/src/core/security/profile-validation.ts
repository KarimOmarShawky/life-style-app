import { z } from 'zod';
const currencies = new Set(Intl.supportedValuesOf('currency'));
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((value) => currencies.has(value), 'Unsupported ISO 4217 currency');
export const timezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone');

import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(72, "Password must be at most 72 characters"),
  fullName: z.string().min(1).max(120),
  companyName: z.string().min(1).max(160),
  phone: z.string().max(32).optional(),
  truckCount: z.coerce.number().int().min(1).max(200).default(1),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const magicLinkSchema = z.object({
  email: z.string().email(),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  companyName: z.string().min(1).max(160).optional(),
  phone: z.string().max(32).nullable().optional(),
  dotNumber: z.string().max(32).nullable().optional(),
  mcNumber: z.string().max(32).nullable().optional(),
  truckCount: z.coerce.number().int().min(1).max(200).optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Please enter a valid email address")
  .max(255, "Email must be under 255 characters");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be under 128 characters")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Project name is required")
  .max(100, "Project name must be under 100 characters")
  .regex(/^[^<>]*$/, "Project name contains invalid characters");

export const deviceNameSchema = z
  .string()
  .trim()
  .min(1, "Device name is required")
  .max(100, "Device name must be under 100 characters")
  .regex(/^[^<>]*$/, "Device name contains invalid characters");

export const displayNameSchema = z
  .string()
  .trim()
  .max(100, "Display name must be under 100 characters")
  .regex(/^[^<>]*$/, "Display name contains invalid characters")
  .optional()
  .or(z.literal(""));

export const inviteEmailSchema = emailSchema;

import { z } from "zod";

// ---------------------------------------------------------------- Auth & Profile
export const signupSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
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

// ---------------------------------------------------------------- Loads
export const loadStatusEnum = z.enum([
  "pending",
  "dispatched",
  "in_transit",
  "delivered",
  "invoiced",
  "paid",
  "overdue",
]);

export const createLoadSchema = z.object({
  loadNumber: z.string().min(1, "Load number is required"),
  brokerName: z.string().min(1, "Broker name is required"),
  brokerContact: z.string().optional(),
  truckNumber: z.string().min(1, "Truck assignment is required"),
  driverName: z.string().min(1, "Driver assignment is required"),
  originCity: z.string().min(1, "Origin city is required"),
  originState: z.string().length(2, "Origin state must be 2 characters"),
  destinationCity: z.string().min(1, "Destination city is required"),
  destinationState: z.string().length(2, "Destination state must be 2 characters"),
  pickupDate: z.string().min(1, "Pickup date is required"),
  deliveryDate: z.string().min(1, "Delivery date is required"),
  commodity: z.string().min(1, "Commodity is required"),
  weightLbs: z.coerce.number().min(0).default(0),
  palletCount: z.coerce.number().min(0).optional(),
  rateAmount: z.coerce.number().min(0, "Rate amount must be positive"),
  fuelSurcharge: z.coerce.number().min(0).default(0),
  detentionAmount: z.coerce.number().min(0).default(0),
  lumperAmount: z.coerce.number().min(0).default(0),
  status: loadStatusEnum.default("pending"),
  notes: z.string().optional(),
});

export const updateLoadSchema = createLoadSchema.partial();

// ---------------------------------------------------------------- Invoices
export const invoiceStatusEnum = z.enum(["draft", "sent", "factoring", "paid", "overdue", "disputed"]);

export const createInvoiceSchema = z.object({
  loadId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  dueDate: z.string().optional(),
  factoringCompany: z.string().optional(),
});

export const updateInvoiceStatusSchema = z.object({
  status: invoiceStatusEnum,
  paidAt: z.string().optional(),
  paymentMethod: z.enum(["check", "ach", "factoring", "other"]).optional(),
});

// ---------------------------------------------------------------- Compliance
export const complianceDocumentTypeEnum = z.enum([
  "insurance",
  "w9",
  "mc_authority",
  "dot_authority",
  "driver_license",
  "medical_card",
  "other",
]);

export const createComplianceSchema = z.object({
  documentType: complianceDocumentTypeEnum,
  title: z.string().min(1),
  fileUrl: z.string().default(""),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  reminderDaysBefore: z.coerce.number().default(30),
});

// ---------------------------------------------------------------- IFTA
export const createIftaSchema = z.object({
  stateCode: z.string().length(2),
  miles: z.coerce.number().min(0),
  fuelGallons: z.coerce.number().min(0),
  quarter: z.coerce.number().int().min(1).max(4).default(3),
  year: z.coerce.number().int().default(2026),
});

// ---------------------------------------------------------------- Detention
export const createDetentionSchema = z.object({
  loadId: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().optional(),
  freeHours: z.coerce.number().default(2),
  hourlyRate: z.coerce.number().default(50),
  reason: z.string().optional(),
});

// ---------------------------------------------------------------- AI Extraction
export const rateConExtractionSchema = z.object({
  loadNumber: z.string().nullable().optional(),
  rateAmount: z.number().nullable().optional(),
  fuelSurcharge: z.number().nullable().optional(),
  shipper: z.string().nullable().optional(),
  consignee: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  pickupDate: z.string().nullable().optional(),
  pickupTime: z.string().nullable().optional(),
  deliveryDate: z.string().nullable().optional(),
  deliveryTime: z.string().nullable().optional(),
  commodity: z.string().nullable().optional(),
  weight: z.number().nullable().optional(),
  detentionFreeHours: z.number().nullable().optional(),
  detentionHourlyRate: z.number().nullable().optional(),
  lumper: z.number().nullable().optional(),
  broker: z.string().nullable().optional(),
  confidence: z.number().min(0).max(100),
});

export const bolExtractionSchema = z.object({
  loadNumber: z.string().nullable().optional(),
  shipper: z.string().nullable().optional(),
  consignee: z.string().nullable().optional(),
  pieces: z.number().nullable().optional(),
  weight: z.number().nullable().optional(),
  commodity: z.string().nullable().optional(),
  pickupDate: z.string().nullable().optional(),
  deliveryDate: z.string().nullable().optional(),
  shipperSignature: z.boolean().default(false),
  receiverSignature: z.boolean().default(false),
  deliveryStatus: z.string().nullable().optional(),
  confidence: z.number().min(0).max(100),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateLoadInput = z.infer<typeof createLoadSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type RateConExtraction = z.infer<typeof rateConExtractionSchema>;
export type BolExtraction = z.infer<typeof bolExtractionSchema>;


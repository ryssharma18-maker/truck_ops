// TruckOps AI — Comprehensive Realistic Demo Data & Fallback Store
// Allows full frontend and backend operation in local demo mode without an active database connection.

export interface DemoTenant {
  id: string;
  name: string;
  dotNumber: string;
  mcNumber: string;
  ownerName: string;
  email: string;
  phone: string;
  inboxEmail: string;
  truckCount: number;
  plan: "trial" | "lite" | "pro" | "enterprise";
}

export interface DemoTruck {
  id: string;
  truckNumber: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  status: "active" | "maintenance" | "inactive";
}

export interface DemoDriver {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  licenseExpiry: string;
  assignedTruckNumber: string;
  status: "active" | "inactive";
}

export interface DemoBroker {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  mcNumber: string;
  paymentTermsDays: number;
  factoringCompany?: string;
  notes?: string;
}

export interface DemoLoad {
  id: string;
  loadNumber: string;
  brokerName: string;
  brokerContact?: string;
  truckNumber: string;
  driverName: string;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  pickupDate: string;
  deliveryDate: string;
  commodity: string;
  weightLbs: number;
  palletCount?: number;
  rateAmount: number;
  fuelSurcharge: number;
  detentionAmount: number;
  lumperAmount: number;
  totalInvoiceAmount: number;
  status: "pending" | "dispatched" | "in_transit" | "delivered" | "invoiced" | "paid";
  notes?: string;
}

export interface DemoDocument {
  id: string;
  loadNumber?: string;
  documentType: "rate_confirmation" | "bill_of_lading" | "proof_of_delivery" | "lumper_receipt" | "fuel_receipt" | "insurance_certificate" | "other";
  fileName: string;
  fileSize: string;
  uploadedAt: string;
  status: "processing" | "needs_review" | "verified" | "failed";
  aiConfidence: number;
  extractedData: {
    loadNumber?: string;
    rateAmount?: number;
    fuelSurcharge?: number;
    origin?: string;
    destination?: string;
    shipper?: string;
    consignee?: string;
    pickupDate?: string;
    deliveryDate?: string;
    commodity?: string;
    weight?: number;
    detentionTerms?: string;
    brokerName?: string;
    notes?: string;
  };
}

export interface DemoInvoice {
  id: string;
  invoiceNumber: string;
  loadNumber: string;
  brokerName: string;
  invoiceDate: string;
  dueDate: string;
  linehaul: number;
  fuelSurcharge: number;
  detention: number;
  lumper: number;
  totalAmount: number;
  status: "draft" | "sent" | "factoring" | "paid" | "overdue";
  daysToPay: number;
  factoringCompany?: string;
}

export interface DemoComplianceItem {
  id: string;
  type: "CDL" | "Medical Card" | "Auto Liability Insurance" | "Registration" | "Annual Inspection" | "MC Authority";
  targetName: string; // e.g., Driver or Truck
  identifier: string;
  issueDate: string;
  expiryDate: string;
  daysRemaining: number;
  status: "healthy" | "expiring_soon" | "expired";
}

export interface DemoIftaRecord {
  id: string;
  stateCode: string;
  stateName: string;
  miles: number;
  fuelGallons: number;
  mpg: number;
  taxRate: number; // per gallon
  taxPaid: number;
  taxOwed: number;
  netTaxDue: number;
}

export interface DemoDashboardStats {
  grossRevenue: number;
  revenueChangePercent: number;
  receivables: number;
  dsoDays: number;
  detentionRecovered: number;
  detentionChangePercent: number;
  activeLoads: number;
  inTransitLoads: number;
  deliveredLoads: number;
  invoicesOutstanding: number;
  overdueInvoicesCount: number;
  complianceWarningsCount: number;
  documentsNeedingReviewCount: number;
}

export const initialTenant: DemoTenant = {
  id: "d0000000-0000-0000-0000-000000000001",
  name: "Rolling Pines Transport LLC",
  dotNumber: "3842119",
  mcNumber: "MC-998231",
  ownerName: "Marcus Vance",
  email: "demo@truckops.ai",
  phone: "+1 (555) 014-2889",
  inboxEmail: "fleet-rollingpines@inbox.truckops.ai",
  truckCount: 3,
  plan: "pro",
};

export const initialTrucks: DemoTruck[] = [
  { id: "trk-1", truckNumber: "101", vin: "1FUJGLDR8CLBP8834", make: "Freightliner", model: "Cascadia", year: 2021, licensePlate: "TX-8842K", status: "active" },
  { id: "trk-2", truckNumber: "102", vin: "3AKJHHDR1LSLT4471", make: "Kenworth", model: "T680", year: 2020, licensePlate: "TX-7719P", status: "active" },
  { id: "trk-3", truckNumber: "103", vin: "1XKYDP9X4KJ218844", make: "Peterbilt", model: "579", year: 2022, licensePlate: "TX-2204M", status: "maintenance" },
];

export const initialDrivers: DemoDriver[] = [
  { id: "drv-1", fullName: "John Smith", phone: "+1 (555) 018-8231", email: "john.smith@truckops.ai", licenseNumber: "TX-DL-4418823", licenseExpiry: "2027-10-15", assignedTruckNumber: "101", status: "active" },
  { id: "drv-2", fullName: "Maria Garcia", phone: "+1 (555) 017-3992", email: "maria.garcia@truckops.ai", licenseNumber: "TX-DL-7729104", licenseExpiry: "2026-10-10", assignedTruckNumber: "102", status: "active" },
];

export const initialBrokers: DemoBroker[] = [
  { id: "brk-1", companyName: "Echo Global Logistics", contactName: "Dana Whitfield", email: "carrier.pay@echo-demo.test", phone: "+1 (800) 555-0101", mcNumber: "MC-484503", paymentTermsDays: 30, notes: "Requires signed POD within 24h of delivery." },
  { id: "brk-2", companyName: "Coyote Logistics", contactName: "Marcus Bell", email: "ap@coyote-demo.test", phone: "+1 (800) 555-0102", mcNumber: "MC-561303", paymentTermsDays: 30, factoringCompany: "TAFS", notes: "Quick pay available at 2.5% discount." },
  { id: "brk-3", companyName: "Total Quality Logistics (TQL)", contactName: "Priya Raman", email: "invoices@tql-demo.test", phone: "+1 (800) 555-0103", mcNumber: "MC-322950", paymentTermsDays: 45, notes: "Detention requires in/out times strictly noted on BOL." },
  { id: "brk-4", companyName: "C.H. Robinson", contactName: "Kevin Miller", email: "freightpayments@chrobinson-demo.test", phone: "+1 (800) 555-0104", mcNumber: "MC-123456", paymentTermsDays: 30 },
];

export const initialLoads: DemoLoad[] = [
  {
    id: "load-1",
    loadNumber: "RP-24130",
    brokerName: "Echo Global Logistics",
    brokerContact: "Dana Whitfield",
    truckNumber: "101",
    driverName: "John Smith",
    originCity: "McAllen",
    originState: "TX",
    destinationCity: "Denver",
    destinationState: "CO",
    pickupDate: "2026-09-17",
    deliveryDate: "2026-09-19",
    commodity: "Fresh Produce (Reefer 34F)",
    weightLbs: 40200,
    palletCount: 22,
    rateAmount: 3100,
    fuelSurcharge: 420,
    detentionAmount: 150,
    lumperAmount: 0,
    totalInvoiceAmount: 3670,
    status: "in_transit",
    notes: "Receiver dock appointment 10:00 AM sharp. Continuous temp check.",
  },
  {
    id: "load-2",
    loadNumber: "RP-24141",
    brokerName: "Coyote Logistics",
    brokerContact: "Marcus Bell",
    truckNumber: "102",
    driverName: "Maria Garcia",
    originCity: "San Antonio",
    originState: "TX",
    destinationCity: "Phoenix",
    destinationState: "AZ",
    pickupDate: "2026-09-21",
    deliveryDate: "2026-09-22",
    commodity: "Palletized Fasteners",
    weightLbs: 36000,
    palletCount: 18,
    rateAmount: 2280,
    fuelSurcharge: 295,
    detentionAmount: 0,
    lumperAmount: 0,
    totalInvoiceAmount: 2575,
    status: "dispatched",
    notes: "Shipper opens 07:00. Strap loads 4x.",
  },
  {
    id: "load-3",
    loadNumber: "RP-24112",
    brokerName: "Total Quality Logistics (TQL)",
    brokerContact: "Priya Raman",
    truckNumber: "101",
    driverName: "John Smith",
    originCity: "Longview",
    originState: "TX",
    destinationCity: "Austin",
    destinationState: "TX",
    pickupDate: "2026-09-09",
    deliveryDate: "2026-09-10",
    commodity: "Kraft Paper Rolls",
    weightLbs: 38500,
    palletCount: 16,
    rateAmount: 1320,
    fuelSurcharge: 165,
    detentionAmount: 150,
    lumperAmount: 0,
    totalInvoiceAmount: 1635,
    status: "invoiced",
    notes: "Waited 5h for unload at Sunbelt Packaging (2h free, 3h detention billed).",
  },
  {
    id: "load-4",
    loadNumber: "RP-24095",
    brokerName: "Coyote Logistics",
    brokerContact: "Marcus Bell",
    truckNumber: "102",
    driverName: "Maria Garcia",
    originCity: "Houston",
    originState: "TX",
    destinationCity: "Mobile",
    destinationState: "AL",
    pickupDate: "2026-08-08",
    deliveryDate: "2026-08-09",
    commodity: "Resin Pellets",
    weightLbs: 44100,
    palletCount: 20,
    rateAmount: 1875,
    fuelSurcharge: 240,
    detentionAmount: 0,
    lumperAmount: 125,
    totalInvoiceAmount: 2240,
    status: "delivered",
    notes: "Lumper fee receipt attached. Invoiced to TAFS factoring.",
  },
  {
    id: "load-5",
    loadNumber: "RP-24081",
    brokerName: "Echo Global Logistics",
    brokerContact: "Dana Whitfield",
    truckNumber: "101",
    driverName: "John Smith",
    originCity: "Fort Worth",
    originState: "TX",
    destinationCity: "Kansas City",
    destinationState: "MO",
    pickupDate: "2026-08-28",
    deliveryDate: "2026-08-29",
    commodity: "Canned Goods",
    weightLbs: 42000,
    palletCount: 24,
    rateAmount: 2450,
    fuelSurcharge: 310,
    detentionAmount: 0,
    lumperAmount: 0,
    totalInvoiceAmount: 2760,
    status: "paid",
    notes: "Direct deposit received via ACH.",
  },
];

export const initialDocuments: DemoDocument[] = [
  {
    id: "doc-1",
    loadNumber: "RP-24130",
    documentType: "rate_confirmation",
    fileName: "RateCon_RP-24130_Echo.pdf",
    fileSize: "214 KB",
    uploadedAt: "Today, 08:42 AM",
    status: "verified",
    aiConfidence: 98,
    extractedData: {
      loadNumber: "RP-24130",
      rateAmount: 3100,
      fuelSurcharge: 420,
      origin: "McAllen, TX",
      destination: "Denver, CO",
      shipper: "Rio Grande Produce Inc.",
      consignee: "Front Range Market DC",
      pickupDate: "2026-09-17",
      deliveryDate: "2026-09-19",
      commodity: "Fresh Produce (Reefer 34F)",
      weight: 40200,
      detentionTerms: "2 hours free, $50/hr after with documented times",
      brokerName: "Echo Global Logistics",
    },
  },
  {
    id: "doc-2",
    loadNumber: "RP-24141",
    documentType: "rate_confirmation",
    fileName: "RateCon_TRK-10482_Coyote.pdf",
    fileSize: "189 KB",
    uploadedAt: "Yesterday, 04:15 PM",
    status: "needs_review",
    aiConfidence: 86,
    extractedData: {
      loadNumber: "RP-24141",
      rateAmount: 2280,
      fuelSurcharge: 295,
      origin: "San Antonio, TX",
      destination: "Phoenix, AZ",
      shipper: "Apex Building Supply",
      consignee: "Desert Ridge Contractors",
      pickupDate: "2026-09-21",
      deliveryDate: "2026-09-22",
      commodity: "Palletized Fasteners",
      weight: 36000,
      detentionTerms: "2 hours free, $55/hr",
      brokerName: "Coyote Logistics",
    },
  },
  {
    id: "doc-3",
    loadNumber: "RP-24112",
    documentType: "bill_of_lading",
    fileName: "BOL_Sunbelt_Signed.pdf",
    fileSize: "412 KB",
    uploadedAt: "Sep 10, 2026",
    status: "verified",
    aiConfidence: 94,
    extractedData: {
      loadNumber: "RP-24112",
      shipper: "Northline Paper Co",
      consignee: "Sunbelt Packaging",
      commodity: "Kraft Paper Rolls",
      weight: 38500,
      pickupDate: "2026-09-09",
      deliveryDate: "2026-09-10",
      notes: "Receiver signature confirmed. In: 13:00, Out: 18:00.",
    },
  },
  {
    id: "doc-4",
    loadNumber: "RP-24095",
    documentType: "lumper_receipt",
    fileName: "Capstone_Lumper_Mobile.jpg",
    fileSize: "1.2 MB",
    uploadedAt: "Aug 09, 2026",
    status: "needs_review",
    aiConfidence: 74,
    extractedData: {
      loadNumber: "RP-24095",
      rateAmount: 125,
      notes: "Faded thermal paper. Re-verify $125 vs $175 unloading fee.",
    },
  },
  {
    id: "doc-5",
    loadNumber: "RP-24081",
    documentType: "proof_of_delivery",
    fileName: "POD_Signed_MidwestGrocery.pdf",
    fileSize: "530 KB",
    uploadedAt: "Aug 29, 2026",
    status: "verified",
    aiConfidence: 96,
    extractedData: {
      loadNumber: "RP-24081",
      consignee: "Midwest Grocery DC",
      deliveryDate: "2026-08-29",
      notes: "Stamp & signature present. Zero damages noted.",
    },
  },
];

export const initialInvoices: DemoInvoice[] = [
  {
    id: "inv-1",
    invoiceNumber: "INV-2026-0003",
    loadNumber: "RP-24112",
    brokerName: "Total Quality Logistics (TQL)",
    invoiceDate: "2026-09-11",
    dueDate: "2026-10-26",
    linehaul: 1320,
    fuelSurcharge: 165,
    detention: 150,
    lumper: 0,
    totalAmount: 1635,
    status: "sent",
    daysToPay: 45,
  },
  {
    id: "inv-2",
    invoiceNumber: "INV-2026-0002",
    loadNumber: "RP-24095",
    brokerName: "Coyote Logistics",
    invoiceDate: "2026-08-10",
    dueDate: "2026-09-09",
    linehaul: 1875,
    fuelSurcharge: 240,
    detention: 0,
    lumper: 125,
    totalAmount: 2240,
    status: "overdue",
    daysToPay: 30,
    factoringCompany: "TAFS Factoring",
  },
  {
    id: "inv-3",
    invoiceNumber: "INV-2026-0001",
    loadNumber: "RP-24081",
    brokerName: "Echo Global Logistics",
    invoiceDate: "2026-08-30",
    dueDate: "2026-09-29",
    linehaul: 2450,
    fuelSurcharge: 310,
    detention: 0,
    lumper: 0,
    totalAmount: 2760,
    status: "paid",
    daysToPay: 30,
  },
];

export const initialCompliance: DemoComplianceItem[] = [
  { id: "cmp-1", type: "Auto Liability Insurance", targetName: "Fleet Policy ($1,000,000)", identifier: "POL-GW-884912", issueDate: "2025-10-15", expiryDate: "2026-10-15", daysRemaining: 27, status: "expiring_soon" },
  { id: "cmp-2", type: "Medical Card", targetName: "Maria Garcia (Driver)", identifier: "DOT-MED-77192", issueDate: "2024-10-10", expiryDate: "2026-10-10", daysRemaining: 22, status: "expiring_soon" },
  { id: "cmp-3", type: "CDL", targetName: "John Smith (Driver)", identifier: "TX-DL-4418823", issueDate: "2023-04-15", expiryDate: "2027-10-15", daysRemaining: 392, status: "healthy" },
  { id: "cmp-4", type: "Annual Inspection", targetName: "Truck #101 (Freightliner)", identifier: "INSP-TX-2026-101", issueDate: "2025-11-04", expiryDate: "2026-11-04", daysRemaining: 47, status: "healthy" },
  { id: "cmp-5", type: "MC Authority", targetName: "Federal Operating Authority", identifier: "MC-998231", issueDate: "2021-03-01", expiryDate: "2030-01-01", daysRemaining: 1200, status: "healthy" },
];

export const initialIfta: DemoIftaRecord[] = [
  { id: "ifta-tx", stateCode: "TX", stateName: "Texas", miles: 8420, fuelGallons: 1238, mpg: 6.8, taxRate: 0.20, taxPaid: 247.60, taxOwed: 247.60, netTaxDue: 0 },
  { id: "ifta-ok", stateCode: "OK", stateName: "Oklahoma", miles: 3120, fuelGallons: 472, mpg: 6.6, taxRate: 0.19, taxPaid: 89.68, taxOwed: 89.68, netTaxDue: 0 },
  { id: "ifta-co", stateCode: "CO", stateName: "Colorado", miles: 2840, fuelGallons: 380, mpg: 7.4, taxRate: 0.22, taxPaid: 83.60, taxOwed: 92.40, netTaxDue: 8.80 },
  { id: "ifta-mo", stateCode: "MO", stateName: "Missouri", miles: 1950, fuelGallons: 290, mpg: 6.7, taxRate: 0.245, taxPaid: 71.05, taxOwed: 71.05, netTaxDue: 0 },
  { id: "ifta-az", stateCode: "AZ", stateName: "Arizona", miles: 1420, fuelGallons: 215, mpg: 6.6, taxRate: 0.26, taxPaid: 55.90, taxOwed: 55.90, netTaxDue: 0 },
];

export const initialStats: DemoDashboardStats = {
  grossRevenue: 184250,
  revenueChangePercent: 12.8,
  receivables: 42680,
  dsoDays: 18,
  detentionRecovered: 8420,
  detentionChangePercent: 23.4,
  activeLoads: 27,
  inTransitLoads: 18,
  deliveredLoads: 9,
  invoicesOutstanding: 7,
  overdueInvoicesCount: 2,
  complianceWarningsCount: 2,
  documentsNeedingReviewCount: 3,
};


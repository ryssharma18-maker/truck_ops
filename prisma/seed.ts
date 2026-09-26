/**
 * Seed script - demo fleet and shipping operation for local development and
 * sales demos.
 *
 *   npm run db:seed
 *
 * Creates the Supabase auth user via the Admin API (service role), which fires
 * on_auth_user_created and produces the public.users row. Everything else is
 * inserted with Prisma. Safe to re-run: it wipes and rebuilds the demo user's
 * data only, and never touches other accounts.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `prisma db seed` loads only `.env`, but the Supabase credentials normally
 * live in `.env.local`. Pull the two we need across as a fallback so the seed
 * works with the standard Next.js split. No dotenv dependency: the format is
 * simple KEY="value" lines.
 */
function loadEnvLocalFallback(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    const key = match?.[1];
    const raw = match?.[2];
    if (!key || raw === undefined) continue;

    if (process.env[key] !== undefined) continue;

    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"));
    const value = quoted ? raw.slice(1, -1) : raw;
    if (value.length === 0) continue;

    process.env[key] = value;
  }
}

loadEnvLocalFallback();

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@truckops.ai";
const DEMO_PASSWORD = "demo1234";

function daysFromNow(days: number, hour = 9): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

async function ensureDemoAuthUser(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Seed needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in " +
        ".env or .env.local",
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log(`  [ok] demo auth user already exists (${existing.id})`);
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true, // skip the confirmation email for the demo account
    user_metadata: {
      full_name: "Demo Owner",
      company_name: "Rolling Pines Transport LLC",
      phone: "+1-555-0142",
      truck_count: 3,
    },
  });

  if (error || !data.user) {
    throw new Error(`Could not create demo auth user: ${error?.message}`);
  }

  // Give the trigger a moment to insert public.users.
  for (let i = 0; i < 10; i++) {
    const row = await prisma.user.findUnique({ where: { id: data.user.id } });
    if (row) return row.id;
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(
    "public.users row was never created - is the on_auth_user_created trigger installed? Run supabase/rls-policies.sql.",
  );
}

async function wipeDemoData(userId: string) {
  // Order matters: children before parents.
  await prisma.$transaction([
    // shipping
    prisma.shippingInvoice.deleteMany({ where: { userId } }),
    prisma.shippingDocument.deleteMany({ where: { userId } }),
    prisma.shippingManifest.deleteMany({ where: { userId } }),
    prisma.shippingContainer.deleteMany({ where: { userId } }),
    prisma.shippingBooking.deleteMany({ where: { userId } }),
    prisma.shippingVessel.deleteMany({ where: { userId } }),
    prisma.shippingPort.deleteMany({ where: { userId } }),
    // trucking
    prisma.invoice.deleteMany({ where: { userId } }),
    prisma.detentionRecord.deleteMany({ where: { userId } }),
    prisma.document.deleteMany({ where: { userId } }),
    prisma.iftaRecord.deleteMany({ where: { userId } }),
    prisma.load.deleteMany({ where: { userId } }),
    prisma.driver.deleteMany({ where: { userId } }),
    prisma.truck.deleteMany({ where: { userId } }),
    prisma.broker.deleteMany({ where: { userId } }),
    prisma.complianceDocument.deleteMany({ where: { userId } }),
    prisma.emailLog.deleteMany({ where: { userId } }),
    prisma.notification.deleteMany({ where: { userId } }),
  ]);
}

async function seedTrucking(userId: string) {
  // ------------------------------------------------------------------ trucks
  const trucks = await Promise.all(
    [
      {
        truckNumber: "101",
        vin: "1FUJGLDR8CLBP8834",
        make: "Freightliner",
        model: "Cascadia",
        year: 2021,
        licensePlate: "TX-8842K",
      },
      {
        truckNumber: "102",
        vin: "3AKJHHDR1LSLT4471",
        make: "Kenworth",
        model: "T680",
        year: 2020,
        licensePlate: "TX-7719P",
      },
      {
        truckNumber: "103",
        vin: "1XKYDP9X4KJ218844",
        make: "Peterbilt",
        model: "579",
        year: 2022,
        licensePlate: "TX-2204M",
        status: "maintenance" as const, // shows up on the Maintenance view
      },
    ].map((t) => prisma.truck.create({ data: { ...t, userId, status: t.status ?? "active" } })),
  );

  // ----------------------------------------------------------------- drivers
  const drivers = await Promise.all([
    prisma.driver.create({
      data: {
        userId,
        fullName: "John Smith",
        phone: "+1-555-0188",
        email: "john.smith@example.com",
        licenseNumber: "TX-DL-4418823",
        licenseExpiry: daysFromNow(410),
        assignedTruckId: trucks[0]!.id,
        status: "active",
      },
    }),
    prisma.driver.create({
      data: {
        userId,
        fullName: "Maria Garcia",
        phone: "+1-555-0173",
        email: "maria.garcia@example.com",
        licenseNumber: "TX-DL-7729104",
        licenseExpiry: daysFromNow(22), // triggers an expiring-soon alert
        assignedTruckId: trucks[1]!.id,
        status: "active",
      },
    }),
  ]);

  // ----------------------------------------------------------------- brokers
  const brokers = await Promise.all([
    prisma.broker.create({
      data: {
        userId,
        companyName: "Echo Global Logistics",
        contactName: "Dana Whitfield",
        email: "carrier.pay@example-echo.test",
        phone: "+1-800-555-0101",
        mcNumber: "MC-484503",
        paymentTermsDays: 30,
        notes: "Requires signed POD within 24h of delivery.",
      },
    }),
    prisma.broker.create({
      data: {
        userId,
        companyName: "Coyote Logistics",
        contactName: "Marcus Bell",
        email: "ap@example-coyote.test",
        phone: "+1-800-555-0102",
        mcNumber: "MC-561303",
        paymentTermsDays: 30,
        factoringCompany: "TAFS",
      },
    }),
    prisma.broker.create({
      data: {
        userId,
        companyName: "Total Quality Logistics",
        contactName: "Priya Raman",
        email: "invoices@example-tql.test",
        phone: "+1-800-555-0103",
        mcNumber: "MC-322950",
        paymentTermsDays: 45,
        notes: "Detention paid only with in/out times documented on the BOL.",
      },
    }),
  ]);

  // ------------------------------------------------------------------- loads
  const loadSpecs = [
    {
      loadNumber: "RP-24081",
      brokerId: brokers[0]!.id,
      truckId: trucks[0]!.id,
      driverId: drivers[0]!.id,
      shipperName: "Cedar Valley Foods",
      shipperAddress: "1400 Industrial Pkwy, Fort Worth, TX 76106",
      consigneeName: "Midwest Grocery DC",
      consigneeAddress: "8800 Commerce Dr, Kansas City, MO 64161",
      pickupDate: daysFromNow(-18, 8),
      deliveryDate: daysFromNow(-17, 14),
      actualDeliveryDate: daysFromNow(-17, 15),
      commodity: "Canned goods",
      weightLbs: 42000,
      palletCount: 24,
      rateAmount: dec(2450),
      fuelSurcharge: dec(310),
      status: "paid" as const,
    },
    {
      loadNumber: "RP-24095",
      brokerId: brokers[1]!.id,
      truckId: trucks[1]!.id,
      driverId: drivers[1]!.id,
      shipperName: "Brightline Plastics",
      shipperAddress: "2201 Refinery Rd, Houston, TX 77015",
      consigneeName: "Gulf Coast Assembly",
      consigneeAddress: "455 Port Access Rd, Mobile, AL 36602",
      pickupDate: daysFromNow(-41, 7),
      deliveryDate: daysFromNow(-40, 12),
      actualDeliveryDate: daysFromNow(-40, 12),
      commodity: "Resin pellets",
      weightLbs: 44100,
      palletCount: 20,
      rateAmount: dec(1875),
      fuelSurcharge: dec(240),
      lumperAmount: dec(125),
      status: "overdue" as const, // invoiced 40 days ago, still unpaid
    },
    {
      loadNumber: "RP-24112",
      brokerId: brokers[2]!.id,
      truckId: trucks[2]!.id,
      driverId: drivers[0]!.id,
      shipperName: "Northline Paper Co",
      shipperAddress: "60 Mill St, Longview, TX 75601",
      consigneeName: "Sunbelt Packaging",
      consigneeAddress: "3300 Airport Blvd, Austin, TX 78719",
      pickupDate: daysFromNow(-9, 9),
      deliveryDate: daysFromNow(-8, 16),
      actualDeliveryDate: daysFromNow(-8, 18),
      commodity: "Kraft paper rolls",
      weightLbs: 38500,
      palletCount: 16,
      rateAmount: dec(1320),
      fuelSurcharge: dec(165),
      detentionAmount: dec(150),
      status: "invoiced" as const,
    },
    {
      loadNumber: "RP-24130",
      brokerId: brokers[0]!.id,
      truckId: trucks[0]!.id,
      driverId: drivers[0]!.id,
      shipperName: "Rio Grande Produce",
      shipperAddress: "12 Harvest Ln, McAllen, TX 78503",
      consigneeName: "Front Range Market",
      consigneeAddress: "775 Wynkoop St, Denver, CO 80202",
      pickupDate: daysFromNow(-1, 6),
      deliveryDate: daysFromNow(1, 10),
      commodity: "Fresh produce (reefer 34F)",
      weightLbs: 40200,
      palletCount: 22,
      rateAmount: dec(3100),
      fuelSurcharge: dec(420),
      status: "in_transit" as const,
      notes: "Reefer must run continuous. Receiver appointment 10:00 sharp.",
    },
    {
      loadNumber: "RP-24141",
      brokerId: brokers[1]!.id,
      shipperName: "Apex Building Supply",
      shipperAddress: "900 Quarry Rd, San Antonio, TX 78219",
      consigneeName: "Desert Ridge Contractors",
      consigneeAddress: "4110 E Cactus Rd, Phoenix, AZ 85032",
      pickupDate: daysFromNow(3, 7),
      deliveryDate: daysFromNow(4, 13),
      commodity: "Palletized fasteners",
      weightLbs: 36000,
      palletCount: 18,
      rateAmount: dec(2280),
      fuelSurcharge: dec(295),
      status: "pending" as const,
      notes: "Created from rate confirmation - truck and driver not assigned yet.",
    },
  ];

  const loads = [];
  for (const spec of loadSpecs) {
    loads.push(await prisma.load.create({ data: { ...spec, userId } }));
  }

  // -------------------------------------------------------------- documents
  const documents: Prisma.DocumentCreateManyInput[] = [
    {
      userId,
      loadId: loads[0]!.id,
      documentType: "rate_confirmation",
      fileUrl: `demo/${userId}/rateconf-RP-24081.pdf`,
      fileName: "rateconf-RP-24081.pdf",
      fileSize: 184320,
      mimeType: "application/pdf",
      uploadedVia: "email",
      aiConfidenceScore: 0.96,
      manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24081",
        broker_name: "Echo Global Logistics",
        broker_mc: "MC-484503",
        shipper_name: "Cedar Valley Foods",
        consignee_name: "Midwest Grocery DC",
        commodity: "Canned goods",
        weight_lbs: 42000,
        rate_amount: 2450,
        fuel_surcharge: 310,
        detention_free_hours: 2,
        detention_hourly_rate: 50,
      },
    },
    {
      userId,
      loadId: loads[0]!.id,
      documentType: "proof_of_delivery",
      fileUrl: `demo/${userId}/pod-RP-24081.jpg`,
      fileName: "pod-RP-24081.jpg",
      fileSize: 902144,
      mimeType: "image/jpeg",
      uploadedVia: "email",
      aiConfidenceScore: 0.91,
      manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24081",
        bol_number: "BOL-778201",
        delivered_date: "2026-08-29",
        delivery_status: "delivered",
        pieces_delivered: 24,
        receiver_name: "T. Okafor",
        shipper_signed: true,
        receiver_signed: true,
      },
    },
    {
      userId,
      loadId: loads[1]!.id,
      documentType: "rate_confirmation",
      fileUrl: `demo/${userId}/rateconf-RP-24095.pdf`,
      fileName: "rateconf-RP-24095.pdf",
      fileSize: 166912,
      mimeType: "application/pdf",
      uploadedVia: "email",
      aiConfidenceScore: 0.94,
      manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24095",
        broker_name: "Coyote Logistics",
        broker_mc: "MC-561303",
        rate_amount: 1875,
        fuel_surcharge: 240,
      },
    },
    {
      userId,
      loadId: loads[1]!.id,
      documentType: "lumper_receipt",
      fileUrl: `demo/${userId}/lumper-RP-24095.jpg`,
      fileName: "lumper-RP-24095.jpg",
      fileSize: 421888,
      mimeType: "image/jpeg",
      uploadedVia: "manual_upload",
      aiConfidenceScore: 0.72,
      manuallyVerified: false, // low confidence -> review queue
      aiExtractedData: {
        facility: "Capstone Logistics",
        amount: 125,
        receipt_number: "CS-88213",
        date: "2026-08-07",
        load_number: null,
      },
    },
    {
      userId,
      loadId: loads[2]!.id,
      documentType: "bill_of_lading",
      fileUrl: `demo/${userId}/bol-RP-24112.pdf`,
      fileName: "bol-RP-24112.pdf",
      fileSize: 211968,
      mimeType: "application/pdf",
      uploadedVia: "email",
      aiConfidenceScore: 0.93,
      manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24112",
        bol_number: "BOL-903118",
        shipper_name: "Northline Paper Co",
        consignee_name: "Sunbelt Packaging",
        commodity: "Kraft paper rolls",
        weight_lbs: 38500,
        pallet_count: 16,
      },
    },
    {
      userId,
      loadId: loads[2]!.id,
      documentType: "proof_of_delivery",
      fileUrl: `demo/${userId}/pod-RP-24112.jpg`,
      fileName: "pod-RP-24112.jpg",
      fileSize: 733184,
      mimeType: "image/jpeg",
      uploadedVia: "email",
      aiConfidenceScore: 0.88,
      manuallyVerified: false,
      aiExtractedData: {
        load_number: "RP-24112",
        delivered_date: "2026-09-08",
        delivery_status: "delivered",
        pieces_delivered: 16,
        receiver_name: "L. Nguyen",
        shipper_signed: true,
        receiver_signed: true,
        notes: "Arrived 16:00, unloaded 18:05",
      },
    },
    {
      userId,
      loadId: loads[3]!.id,
      documentType: "rate_confirmation",
      fileUrl: `demo/${userId}/rateconf-RP-24130.pdf`,
      fileName: "rateconf-RP-24130.pdf",
      fileSize: 197632,
      mimeType: "application/pdf",
      uploadedVia: "email",
      aiConfidenceScore: 0.97,
      manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24130",
        broker_name: "Echo Global Logistics",
        rate_amount: 3100,
        fuel_surcharge: 420,
        commodity: "Fresh produce (reefer 34F)",
      },
    },
    {
      userId,
      loadId: loads[4]!.id,
      documentType: "rate_confirmation",
      fileUrl: `demo/${userId}/rateconf-RP-24141.pdf`,
      fileName: "rateconf-RP-24141.pdf",
      fileSize: 174080,
      mimeType: "application/pdf",
      uploadedVia: "email",
      aiConfidenceScore: 0.83,
      manuallyVerified: false, // below the review threshold
      aiExtractedData: {
        load_number: "RP-24141",
        broker_name: "Coyote Logistics",
        rate_amount: 2280,
        fuel_surcharge: 295,
        weight_lbs: 36000,
      },
    },
    {
      userId,
      loadId: null,
      documentType: "fuel_receipt",
      fileUrl: `demo/${userId}/fuel-loves-okc.jpg`,
      fileName: "fuel-loves-okc.jpg",
      fileSize: 312320,
      mimeType: "image/jpeg",
      uploadedVia: "manual_upload",
      aiConfidenceScore: 0.9,
      manuallyVerified: false,
      aiExtractedData: {
        station: "Love's Travel Stop #412",
        state: "OK",
        gallons: 118.4,
        price_per_gallon: 3.73,
        total_amount: 441.22,
        date: "2026-09-05",
      },
    },
    {
      userId,
      loadId: null,
      documentType: "fuel_receipt",
      fileUrl: `demo/${userId}/fuel-pilot-amarillo.jpg`,
      fileName: "fuel-pilot-amarillo.jpg",
      fileSize: 288768,
      mimeType: "image/jpeg",
      uploadedVia: "email",
      aiConfidenceScore: 0.64,
      manuallyVerified: false, // crumpled receipt -> low confidence
      aiExtractedData: {
        station: "Pilot Travel Center",
        state: "TX",
        gallons: 96.2,
        total_amount: 357.9,
        date: "2026-09-11",
      },
    },
  ];
  await prisma.document.createMany({ data: documents });

  // --------------------------------------------------------------- invoices
  await prisma.invoice.createMany({
    data: [
      {
        userId,
        loadId: loads[0]!.id,
        invoiceNumber: "INV-2026-0001",
        invoiceDate: daysFromNow(-17),
        dueDate: daysFromNow(13),
        billToBrokerId: brokers[0]!.id,
        subtotal: dec(2450),
        fuelSurcharge: dec(310),
        totalAmount: dec(2760),
        status: "paid",
        sentAt: daysFromNow(-17),
        paidAt: daysFromNow(-4),
        paymentMethod: "ach",
      },
      {
        userId,
        loadId: loads[1]!.id,
        invoiceNumber: "INV-2026-0002",
        invoiceDate: daysFromNow(-40),
        dueDate: daysFromNow(-10),
        billToBrokerId: brokers[1]!.id,
        subtotal: dec(1875),
        fuelSurcharge: dec(240),
        lumperCharges: dec(125),
        totalAmount: dec(2240),
        status: "overdue",
        sentAt: daysFromNow(-40),
        factoringCompany: "TAFS",
        reminderCount: 2,
        lastReminderSentAt: daysFromNow(-5),
      },
      {
        userId,
        loadId: loads[2]!.id,
        invoiceNumber: "INV-2026-0003",
        invoiceDate: daysFromNow(-7),
        dueDate: daysFromNow(38),
        billToBrokerId: brokers[2]!.id,
        subtotal: dec(1320),
        fuelSurcharge: dec(165),
        detentionCharges: dec(150),
        totalAmount: dec(1635),
        status: "sent",
        sentAt: daysFromNow(-7),
      },
    ],
  });

  // -------------------------------------------------------------- detention
  await prisma.detentionRecord.createMany({
    data: [
      {
        userId,
        loadId: loads[3]!.id,
        startTime: new Date(Date.now() - 3.5 * 60 * 60 * 1000), // running for 3.5h
        freeHours: 2,
        hourlyRate: dec(50),
        reason: "Receiver dock congestion at Front Range Market",
        status: "active",
      },
      {
        userId,
        loadId: loads[2]!.id,
        startTime: daysFromNow(-8, 16),
        endTime: daysFromNow(-8, 21),
        freeHours: 2,
        hourlyRate: dec(50),
        totalHours: dec(5),
        totalCharge: dec(150),
        reason: "Waited 5h for unload at Sunbelt Packaging",
        status: "invoiced",
      },
    ],
  });

  // ------------------------------------------------------------- compliance
  await prisma.complianceDocument.createMany({
    data: [
      {
        userId,
        documentType: "insurance",
        title: "Auto Liability - Great West ($1M)",
        fileUrl: `demo/${userId}/coi-greatwest.pdf`,
        issueDate: daysFromNow(-340),
        expiryDate: daysFromNow(25),
        reminderDaysBefore: 30,
        status: "expiring_soon",
      },
      {
        userId,
        documentType: "medical_card",
        title: "Medical Card - Maria Garcia",
        fileUrl: `demo/${userId}/medcard-garcia.pdf`,
        issueDate: daysFromNow(-700),
        expiryDate: daysFromNow(12),
        reminderDaysBefore: 30,
        status: "expiring_soon",
      },
      {
        userId,
        documentType: "w9",
        title: "W-9 - Rolling Pines Transport LLC",
        fileUrl: `demo/${userId}/w9.pdf`,
        issueDate: daysFromNow(-120),
        status: "valid",
      },
      {
        userId,
        documentType: "mc_authority",
        title: "MC Authority Letter (MC-998231)",
        fileUrl: `demo/${userId}/mc-authority.pdf`,
        issueDate: daysFromNow(-900),
        status: "valid",
      },
    ],
  });

  return { trucks, drivers, brokers, loads, documentCount: documents.length };
}

async function seedShipping(userId: string) {
  // ------------------------------------------------------------------- ports
  const portSpecs = [
    { unlocode: "USHOU", name: "Port of Houston", country: "United States" },
    { unlocode: "USLAX", name: "Port of Los Angeles", country: "United States" },
    { unlocode: "USNYC", name: "Port of New York", country: "United States" },
    { unlocode: "USSAV", name: "Port of Savannah", country: "United States" },
    { unlocode: "MXZLO", name: "Puerto de Manzanillo", country: "Mexico" },
    { unlocode: "NLRTM", name: "Port of Rotterdam", country: "Netherlands" },
  ];
  const ports = await Promise.all(
    portSpecs.map((p) => prisma.shippingPort.create({ data: { ...p, userId } })),
  );
  const port = (unlocode: string) => ports.find((p) => p.unlocode === unlocode)!;

  // ----------------------------------------------------------------- vessels
  const vesselSpecs = [
    {
      imoNumber: "IMO9834700",
      name: "MV Pacific Trader",
      flag: "Panama",
      vesselType: "Container",
      capacityTeu: 5400,
      deadweightTons: 82000,
      status: "at_sea" as const,
    },
    {
      imoNumber: "IMO9755112",
      name: "MV Atlantic Voyager",
      flag: "Liberia",
      vesselType: "Container",
      capacityTeu: 7100,
      deadweightTons: 105000,
      status: "in_port" as const,
    },
    {
      imoNumber: "IMO9902334",
      name: "MV Gulf Meridian",
      flag: "Marshall Islands",
      vesselType: "Container",
      capacityTeu: 3200,
      deadweightTons: 48000,
      status: "active" as const,
    },
  ];
  const vessels = await Promise.all(
    vesselSpecs.map((v) => prisma.shippingVessel.create({ data: { ...v, userId } })),
  );

  // ---------------------------------------------------------------- bookings
  const bookingSpecs = [
    {
      bookingNumber: "SHP-2026-0412",
      shipperName: "Rio Grande Produce",
      consigneeName: "Front Range Market",
      vesselId: vessels[0]!.id,
      portOfLoadingId: port("USHOU").id,
      portOfDischargeId: port("USLAX").id,
      etd: daysFromNow(-9, 4),
      eta: daysFromNow(4, 18),
      status: "in_transit" as const,
      freightTerms: "FOB",
      commodity: "Fresh produce, reefer 34F",
    },
    {
      bookingNumber: "SHP-2026-0418",
      shipperName: "Brightline Plastics",
      consigneeName: "Gulf Coast Assembly",
      vesselId: vessels[1]!.id,
      portOfLoadingId: port("USNYC").id,
      portOfDischargeId: port("NLRTM").id,
      etd: daysFromNow(2, 6),
      eta: daysFromNow(16, 9),
      status: "confirmed" as const,
      freightTerms: "CIF",
      commodity: "Resin pellets, containerized",
    },
    {
      bookingNumber: "SHP-2026-0423",
      shipperName: "Northline Paper Co",
      consigneeName: "Sunbelt Packaging",
      vesselId: vessels[2]!.id,
      portOfLoadingId: port("USSAV").id,
      portOfDischargeId: port("MXZLO").id,
      etd: daysFromNow(6, 3),
      eta: daysFromNow(11, 15),
      status: "pending" as const,
      freightTerms: "FOB",
      commodity: "Kraft paper rolls",
      notes: "Awaiting carrier booking confirmation.",
    },
    {
      bookingNumber: "SHP-2026-0401",
      shipperName: "Cedar Valley Foods",
      consigneeName: "Midwest Grocery DC",
      vesselId: vessels[0]!.id,
      portOfLoadingId: port("USHOU").id,
      portOfDischargeId: port("USLAX").id,
      etd: daysFromNow(-24, 8),
      eta: daysFromNow(-11, 12),
      status: "delivered" as const,
      freightTerms: "FOB",
      commodity: "Canned goods",
    },
  ];
  const bookings = await Promise.all(
    bookingSpecs.map((b) => prisma.shippingBooking.create({ data: { ...b, userId } })),
  );

  // -------------------------------------------------------------- containers
  await prisma.shippingContainer.createMany({
    data: [
      {
        userId,
        bookingId: bookings[0]!.id,
        containerNumber: "MSKU7284103",
        size: "ft40hc" as const,
        type: "reefer" as const,
        sealNumber: "SL-448120",
        weightKg: dec(18400),
      },
      {
        userId,
        bookingId: bookings[0]!.id,
        containerNumber: "MSKU7284104",
        size: "ft40hc" as const,
        type: "reefer" as const,
        sealNumber: "SL-448121",
        weightKg: dec(17900),
      },
      {
        userId,
        bookingId: bookings[1]!.id,
        containerNumber: "TGHU5519088",
        size: "ft40" as const,
        type: "dry" as const,
        sealNumber: "SL-551002",
        weightKg: dec(22400),
      },
      {
        userId,
        bookingId: bookings[2]!.id,
        containerNumber: "CMAU3390117",
        size: "ft20" as const,
        type: "dry" as const,
        weightKg: dec(18600),
      },
      {
        userId,
        bookingId: bookings[3]!.id,
        containerNumber: "TCLU2204871",
        size: "ft40" as const,
        type: "dry" as const,
        sealNumber: "SL-220119",
        weightKg: dec(21100),
      },
    ],
  });

  // --------------------------------------------------------------- manifests
  await prisma.shippingManifest.createMany({
    data: [
      {
        userId,
        bookingId: bookings[0]!.id,
        manifestNumber: "MAN-2026-1188",
        status: "approved" as const,
        notes: "Two reefer units, continuous 34F set point.",
      },
      {
        userId,
        bookingId: bookings[1]!.id,
        manifestNumber: "MAN-2026-1203",
        status: "submitted" as const,
      },
      {
        userId,
        bookingId: bookings[2]!.id,
        manifestNumber: "MAN-2026-1219",
        status: "draft" as const,
      },
    ],
  });

  // --------------------------------------------------------------- documents
  await prisma.shippingDocument.createMany({
    data: [
      {
        userId,
        bookingId: bookings[0]!.id,
        documentType: "bill_of_lading" as const,
        fileName: "bol-SHP-2026-0412.pdf",
        fileUrl: `demo/${userId}/shipping/bol-SHP-2026-0412.pdf`,
        source: "email",
        emailFrom: "docs@carrier-logistics.example",
        extractionStatus: "completed" as const,
        confidence: 0.94,
        expiresAt: daysFromNow(120),
        extractedData: {
          bol_number: "BOL-MAR-4471902",
          booking_number: "SHP-2026-0412",
          shipper_name: "Rio Grande Produce",
          consignee_name: "Front Range Market",
          port_of_loading: "Houston, US",
          port_of_discharge: "Los Angeles, US",
          etd: "2026-09-17",
          eta: "2026-09-30",
          piece_count: 2,
          weight_lbs: 80000,
        },
      },
      {
        userId,
        bookingId: bookings[0]!.id,
        documentType: "packing_list" as const,
        fileName: "packinglist-SHP-2026-0412.pdf",
        fileUrl: `demo/${userId}/shipping/packinglist-SHP-2026-0412.pdf`,
        source: "email",
        emailFrom: "docs@carrier-logistics.example",
        extractionStatus: "completed" as const,
        confidence: 0.88,
        extractedData: {
          booking_number: "SHP-2026-0412",
          total_packages: 1840,
          total_weight_kg: 36300,
          total_volume_cbm: 58.4,
          marks_and_numbers: "RGP/HTX-2026",
        },
      },
      {
        userId,
        bookingId: bookings[1]!.id,
        documentType: "commercial_invoice" as const,
        fileName: "invoice-SHP-2026-0418.pdf",
        fileUrl: `demo/${userId}/shipping/invoice-SHP-2026-0418.pdf`,
        source: "manual_upload",
        extractionStatus: "completed" as const,
        confidence: 0.76,
        extractedData: {
          invoice_number: "CI-99120",
          invoice_date: "2026-09-25",
          seller_name: "Brightline Plastics",
          buyer_name: "Gulf Coast Assembly",
          booking_number: "SHP-2026-0418",
          vessel_name: "MV Atlantic Voyager",
          port_of_loading: "New York, US",
          port_of_discharge: "Rotterdam, NL",
          freight_terms: "CIF",
          currency: "USD",
          total_amount: 42800,
        },
      },
      {
        userId,
        bookingId: bookings[2]!.id,
        documentType: "customs_declaration" as const,
        fileName: "customs-SHP-2026-0423.pdf",
        fileUrl: `demo/${userId}/shipping/customs-SHP-2026-0423.pdf`,
        source: "email",
        emailFrom: "compliance@ocean-brokers.example",
        extractionStatus: "pending" as const,
      },
      {
        userId,
        bookingId: bookings[3]!.id,
        documentType: "certificate_of_origin" as const,
        fileName: "coo-SHP-2026-0401.pdf",
        fileUrl: `demo/${userId}/shipping/coo-SHP-2026-0401.pdf`,
        source: "email",
        emailFrom: "docs@carrier-logistics.example",
        extractionStatus: "completed" as const,
        confidence: 0.97,
        expiresAt: daysFromNow(-2), // already lapsed -> compliance alert
        extractedData: {
          certificate_number: "COO-2026-77120",
          booking_number: "SHP-2026-0401",
          shipper_name: "Cedar Valley Foods",
          consignee_name: "Midwest Grocery DC",
          country_of_origin: "United States",
        },
      },
    ],
  });

  // -------------------------------------------------------- shipping invoices
  await prisma.shippingInvoice.createMany({
    data: [
      {
        userId,
        bookingId: bookings[3]!.id,
        invoiceNumber: "SINV-2026-0001",
        amount: dec(12400),
        status: "paid" as const,
        issueDate: daysFromNow(-11),
        dueDate: daysFromNow(4),
        paidAt: daysFromNow(-6),
        notes: "Freight and documentation for delivered sailing.",
      },
      {
        userId,
        bookingId: bookings[1]!.id,
        invoiceNumber: "SINV-2026-0002",
        amount: dec(42800),
        status: "sent" as const,
        issueDate: daysFromNow(-2),
        dueDate: daysFromNow(28),
        notes: "CIF Rotterdam sailing.",
      },
      {
        userId,
        bookingId: bookings[0]!.id,
        invoiceNumber: "SINV-2026-0003",
        amount: dec(18750),
        status: "overdue" as const,
        issueDate: daysFromNow(-52),
        dueDate: daysFromNow(-22),
        notes: "Awaiting remittance from Front Range Market.",
      },
    ],
  });

  return { ports, vessels, bookings };
}

async function main() {
  console.log("Seeding TruckOps AI demo data...");

  const userId = await ensureDemoAuthUser();
  await wipeDemoData(userId);

  await prisma.user.update({
    where: { id: userId },
    data: {
      fullName: "Demo Owner",
      companyName: "Rolling Pines Transport LLC",
      phone: "+1-555-0142",
      dotNumber: "3842119",
      mcNumber: "MC-998231",
      subscriptionPlan: "trial",
      truckCount: 3,
    },
  });

  const trucking = await seedTrucking(userId);
  const shipping = await seedShipping(userId);

  await prisma.notification.createMany({
    data: [
      {
        userId,
        title: "Invoice overdue",
        type: "error",
        message: "INV-2026-0002 to Coyote Logistics is 10 days past due ($2,240.00).",
        actionUrl: "/dashboard/invoices",
      },
      {
        userId,
        title: "Shipping invoice overdue",
        type: "error",
        message: "SINV-2026-0003 is 22 days past due ($18,750.00).",
        actionUrl: "/dashboard/shipping/invoices",
      },
      {
        userId,
        title: "Insurance expiring in 25 days",
        type: "warning",
        message: "Great West auto liability certificate needs renewal.",
        actionUrl: "/dashboard/compliance",
      },
      {
        userId,
        title: "Certificate of origin expired",
        type: "warning",
        message: "COO-2026-77120 for SHP-2026-0401 lapsed 2 days ago.",
        actionUrl: "/dashboard/shipping/compliance",
      },
      {
        userId,
        title: "2 documents need review",
        type: "warning",
        message: "Low-confidence extraction on a lumper receipt and a fuel receipt.",
        actionUrl: "/dashboard/documents",
      },
      {
        userId,
        title: "Detention timer running",
        type: "info",
        message: "Load RP-24130 has been on the clock for over 3 hours.",
        actionUrl: "/dashboard/trips",
        read: true,
      },
    ],
  });

  console.log(`
  Done.
    Login:  ${DEMO_EMAIL} / ${DEMO_PASSWORD}

    Trucking
      Trucks:    ${trucking.trucks.length}
      Drivers:   ${trucking.drivers.length}
      Brokers:   ${trucking.brokers.length}
      Loads:     ${trucking.loads.length}
      Documents: ${trucking.documentCount}
      Invoices:  3

    Shipping
      Ports:     ${shipping.ports.length}
      Vessels:   ${shipping.vessels.length}
      Bookings:  ${shipping.bookings.length}
      Containers: 5, Manifests: 3, Documents: 5, Invoices: 3
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

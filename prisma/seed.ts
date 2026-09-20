/**
 * Seed script â€” demo fleet for local development and sales demos.
 *
 *   npx prisma db seed
 *
 * Creates or upserts the demo user. If live Supabase Auth credentials are
 * available, it connects via the Supabase Admin API; otherwise, it creates
 * the demo tenant directly in PostgreSQL via Prisma.
 * Safe to re-run: it wipes and rebuilds the demo user's data only.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

const DEMO_USER_ID = "d0000000-0000-0000-0000-000000000001";
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

  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log(`  â†³ demo tenant already exists (${existing.id})`);
    return existing.id;
  }

  // If live Supabase admin keys are provided, create via Auth Admin API
  const hasLiveSupabaseAuth =
    url &&
    serviceKey &&
    !url.includes("placeholder") &&
    !serviceKey.includes("placeholder");

  if (hasLiveSupabaseAuth) {
    try {
      const admin = createClient(url!, serviceKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data, error } = await admin.auth.admin.createUser({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: {
          full_name: "Demo Owner",
          company_name: "Rolling Pines Transport LLC",
          phone: "+1-555-0142",
          truck_count: 3,
        },
      });

      if (!error && data.user) {
        // Wait briefly for the on_auth_user_created trigger if installed
        for (let i = 0; i < 10; i++) {
          const row = await prisma.user.findUnique({ where: { id: data.user.id } });
          if (row) return data.user.id;
          await new Promise((r) => setTimeout(r, 200));
        }

        // If trigger not yet installed, insert public.users row directly
        const user = await prisma.user.upsert({
          where: { id: data.user.id },
          update: {},
          create: {
            id: data.user.id,
            email: DEMO_EMAIL,
            fullName: "Demo Owner",
            companyName: "Rolling Pines Transport LLC",
            phone: "+1-555-0142",
            truckCount: 3,
            inboxEmail: "fleet-demo@inbox.truckops.ai",
          },
        });
        return user.id;
      }
    } catch (e) {
      console.warn("  â†³ Supabase Admin API unavailable, creating user directly in DB");
    }
  }

  console.log("  â†³ Creating demo tenant directly via Prisma");
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      fullName: "Demo Owner",
      companyName: "Rolling Pines Transport LLC",
      phone: "+1-555-0142",
      dotNumber: "3842119",
      mcNumber: "MC-998231",
      subscriptionPlan: "trial",
      truckCount: 3,
      inboxEmail: "fleet-demo@inbox.truckops.ai",
    },
  });

  return user.id;
}

async function wipeDemoData(userId: string) {
  // Order matters: children before parents.
  await prisma.$transaction([
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

async function main() {
  console.log("Seeding TruckOps AI demo dataâ€¦");

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

  // ---------------------------------------------------------------- trucks
  const trucks = await Promise.all(
    [
      { truckNumber: "101", vin: "1FUJGLDR8CLBP8834", make: "Freightliner", model: "Cascadia", year: 2021, licensePlate: "TX-8842K" },
      { truckNumber: "102", vin: "3AKJHHDR1LSLT4471", make: "Kenworth", model: "T680", year: 2020, licensePlate: "TX-7719P" },
      { truckNumber: "103", vin: "1XKYDP9X4KJ218844", make: "Peterbilt", model: "579", year: 2022, licensePlate: "TX-2204M" },
    ].map((t) => prisma.truck.create({ data: { ...t, userId, status: "active" } })),
  );

  // --------------------------------------------------------------- drivers
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

  // --------------------------------------------------------------- brokers
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

  // ----------------------------------------------------------------- loads
  const loadSpecs = [
    {
      loadNumber: "RP-24081",
      brokerId: brokers[0].id,
      truckId: trucks[0]!.id,
      driverId: drivers[0].id,
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
      brokerId: brokers[1].id,
      truckId: trucks[1]!.id,
      driverId: drivers[1].id,
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
      brokerId: brokers[2].id,
      truckId: trucks[2]!.id,
      driverId: drivers[0].id,
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
      brokerId: brokers[0].id,
      truckId: trucks[0]!.id,
      driverId: drivers[0].id,
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
      brokerId: brokers[1].id,
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
      notes: "Created from rate confirmation â€” truck and driver not assigned yet.",
    },
  ];

  const loads = [];
  for (const spec of loadSpecs) {
    loads.push(await prisma.load.create({ data: { ...spec, userId } }));
  }

  // ------------------------------------------------------------- documents
  // ai_extracted_data mirrors what the GPT-4o Vision extractor returns.
  const documents: Prisma.DocumentCreateManyInput[] = [
    {
      userId, loadId: loads[0]!.id, documentType: "rate_confirmation",
      fileUrl: `demo/${userId}/rateconf-RP-24081.pdf`, fileName: "rateconf-RP-24081.pdf",
      fileSize: 184320, mimeType: "application/pdf", uploadedVia: "email",
      aiConfidenceScore: 0.96, manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24081", broker_name: "Echo Global Logistics", broker_mc: "MC-484503",
        shipper_name: "Cedar Valley Foods", consignee_name: "Midwest Grocery DC",
        commodity: "Canned goods", weight_lbs: 42000, rate_amount: 2450,
        fuel_surcharge: 310, detention_terms: "2 hours free, then $50/hr", confidence: 0.96,
      },
    },
    {
      userId, loadId: loads[0]!.id, documentType: "proof_of_delivery",
      fileUrl: `demo/${userId}/pod-RP-24081.jpg`, fileName: "pod-RP-24081.jpg",
      fileSize: 902144, mimeType: "image/jpeg", uploadedVia: "email",
      aiConfidenceScore: 0.91, manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24081", bol_number: "BOL-778201", delivery_date: "2026-08-29",
        delivery_time: "15:10", receiver_name: "T. Okafor", signature_present: true, confidence: 0.91,
      },
    },
    {
      userId, loadId: loads[1]!.id, documentType: "rate_confirmation",
      fileUrl: `demo/${userId}/rateconf-RP-24095.pdf`, fileName: "rateconf-RP-24095.pdf",
      fileSize: 166912, mimeType: "application/pdf", uploadedVia: "email",
      aiConfidenceScore: 0.94, manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24095", broker_name: "Coyote Logistics", broker_mc: "MC-561303",
        rate_amount: 1875, fuel_surcharge: 240, confidence: 0.94,
      },
    },
    {
      userId, loadId: loads[1]!.id, documentType: "lumper_receipt",
      fileUrl: `demo/${userId}/lumper-RP-24095.jpg`, fileName: "lumper-RP-24095.jpg",
      fileSize: 421888, mimeType: "image/jpeg", uploadedVia: "manual_upload",
      aiConfidenceScore: 0.72, manuallyVerified: false,
      aiExtractedData: {
        vendor_name: "Capstone Logistics", amount: 125, date: "2026-08-07",
        load_number: null, confidence: 0.72,
      },
    },
    {
      userId, loadId: loads[2]!.id, documentType: "bill_of_lading",
      fileUrl: `demo/${userId}/bol-RP-24112.pdf`, fileName: "bol-RP-24112.pdf",
      fileSize: 211968, mimeType: "application/pdf", uploadedVia: "email",
      aiConfidenceScore: 0.93, manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24112", bol_number: "BOL-903118", shipper_name: "Northline Paper Co",
        consignee_name: "Sunbelt Packaging", commodity: "Kraft paper rolls",
        weight_lbs: 38500, pallet_count: 16, confidence: 0.93,
      },
    },
    {
      userId, loadId: loads[2]!.id, documentType: "proof_of_delivery",
      fileUrl: `demo/${userId}/pod-RP-24112.jpg`, fileName: "pod-RP-24112.jpg",
      fileSize: 733184, mimeType: "image/jpeg", uploadedVia: "email",
      aiConfidenceScore: 0.88, manuallyVerified: false,
      aiExtractedData: {
        load_number: "RP-24112", delivery_date: "2026-09-08", delivery_time: "18:05",
        receiver_name: "L. Nguyen", signature_present: true,
        notes: "Arrived 16:00, unloaded 18:05", confidence: 0.88,
      },
    },
    {
      userId, loadId: loads[3]!.id, documentType: "rate_confirmation",
      fileUrl: `demo/${userId}/rateconf-RP-24130.pdf`, fileName: "rateconf-RP-24130.pdf",
      fileSize: 197632, mimeType: "application/pdf", uploadedVia: "email",
      aiConfidenceScore: 0.97, manuallyVerified: true,
      aiExtractedData: {
        load_number: "RP-24130", broker_name: "Echo Global Logistics",
        rate_amount: 3100, fuel_surcharge: 420, commodity: "Fresh produce (reefer 34F)",
        special_instructions: "Continuous reefer at 34F", confidence: 0.97,
      },
    },
    {
      userId, loadId: loads[4]!.id, documentType: "rate_confirmation",
      fileUrl: `demo/${userId}/rateconf-RP-24141.pdf`, fileName: "rateconf-RP-24141.pdf",
      fileSize: 174080, mimeType: "application/pdf", uploadedVia: "email",
      aiConfidenceScore: 0.83, manuallyVerified: false,
      aiExtractedData: {
        load_number: "RP-24141", broker_name: "Coyote Logistics",
        rate_amount: 2280, fuel_surcharge: 295, weight_lbs: 36000, confidence: 0.83,
      },
    },
    {
      userId, loadId: null, documentType: "fuel_receipt",
      fileUrl: `demo/${userId}/fuel-loves-okc.jpg`, fileName: "fuel-loves-okc.jpg",
      fileSize: 312320, mimeType: "image/jpeg", uploadedVia: "manual_upload",
      aiConfidenceScore: 0.9, manuallyVerified: false,
      aiExtractedData: {
        vendor_name: "Love's Travel Stop #412", state: "OK", gallons: 118.4,
        amount: 441.22, date: "2026-09-05", truck_number: "101", odometer: 412885, confidence: 0.9,
      },
    },
    {
      userId, loadId: null, documentType: "fuel_receipt",
      fileUrl: `demo/${userId}/fuel-pilot-amarillo.jpg`, fileName: "fuel-pilot-amarillo.jpg",
      fileSize: 288768, mimeType: "image/jpeg", uploadedVia: "email",
      aiConfidenceScore: 0.64, manuallyVerified: false,
      aiExtractedData: {
        vendor_name: "Pilot Travel Center", state: "TX", gallons: 96.2,
        amount: 357.9, date: "2026-09-11", truck_number: null, odometer: null, confidence: 0.64,
      },
    },
  ];
  await prisma.document.createMany({ data: documents });

  // -------------------------------------------------------------- invoices
  await prisma.invoice.createMany({
    data: [
      {
        userId, loadId: loads[0]!.id, invoiceNumber: "INV-2026-0001",
        invoiceDate: daysFromNow(-17), dueDate: daysFromNow(13),
        billToBrokerId: brokers[0].id, subtotal: dec(2450), fuelSurcharge: dec(310),
        totalAmount: dec(2760), status: "paid",
        sentAt: daysFromNow(-17), paidAt: daysFromNow(-4), paymentMethod: "ach",
      },
      {
        userId, loadId: loads[1]!.id, invoiceNumber: "INV-2026-0002",
        invoiceDate: daysFromNow(-40), dueDate: daysFromNow(-10),
        billToBrokerId: brokers[1].id, subtotal: dec(1875), fuelSurcharge: dec(240),
        lumperCharges: dec(125), totalAmount: dec(2240), status: "overdue",
        sentAt: daysFromNow(-40), factoringCompany: "TAFS",
        reminderCount: 2, lastReminderSentAt: daysFromNow(-5),
      },
      {
        userId, loadId: loads[2]!.id, invoiceNumber: "INV-2026-0003",
        invoiceDate: daysFromNow(-7), dueDate: daysFromNow(38),
        billToBrokerId: brokers[2].id, subtotal: dec(1320), fuelSurcharge: dec(165),
        detentionCharges: dec(150), totalAmount: dec(1635), status: "sent",
        sentAt: daysFromNow(-7),
      },
    ],
  });

  // ------------------------------------------------------------- detention
  await prisma.detentionRecord.create({
    data: {
      userId, loadId: loads[3]!.id,
      startTime: new Date(Date.now() - 3.5 * 60 * 60 * 1000), // running for 3.5h
      freeHours: 2, hourlyRate: dec(50),
      reason: "Receiver dock congestion at Front Range Market",
      status: "active",
    },
  });

  await prisma.detentionRecord.create({
    data: {
      userId, loadId: loads[2]!.id,
      startTime: daysFromNow(-8, 16), endTime: daysFromNow(-8, 21),
      freeHours: 2, hourlyRate: dec(50), totalHours: dec(5), totalCharge: dec(150),
      reason: "Waited 5h for unload at Sunbelt Packaging",
      status: "invoiced",
    },
  });

  // ------------------------------------------------------------ compliance
  await prisma.complianceDocument.createMany({
    data: [
      {
        userId, documentType: "insurance", title: "Auto Liability â€” Great West ($1M)",
        fileUrl: `demo/${userId}/coi-greatwest.pdf`,
        issueDate: daysFromNow(-340), expiryDate: daysFromNow(25),
        reminderDaysBefore: 30, status: "expiring_soon",
      },
      {
        userId, documentType: "medical_card", title: "Medical Card â€” Maria Garcia",
        fileUrl: `demo/${userId}/medcard-garcia.pdf`,
        issueDate: daysFromNow(-700), expiryDate: daysFromNow(12),
        reminderDaysBefore: 30, status: "expiring_soon",
      },
      {
        userId, documentType: "w9", title: "W-9 â€” Rolling Pines Transport LLC",
        fileUrl: `demo/${userId}/w9.pdf`, issueDate: daysFromNow(-120), status: "valid",
      },
      {
        userId, documentType: "mc_authority", title: "MC Authority Letter (MC-998231)",
        fileUrl: `demo/${userId}/mc-authority.pdf`, issueDate: daysFromNow(-900), status: "valid",
      },
    ],
  });

  // ---------------------------------------------------------- notifications
  await prisma.notification.createMany({
    data: [
      {
        userId, title: "Invoice overdue", type: "error",
        message: "INV-2026-0002 to Coyote Logistics is 10 days past due ($2,240.00).",
        actionUrl: "/dashboard/invoices",
      },
      {
        userId, title: "Insurance expiring in 25 days", type: "warning",
        message: "Great West auto liability certificate needs renewal.",
        actionUrl: "/dashboard/compliance",
      },
      {
        userId, title: "2 documents need review", type: "warning",
        message: "Low-confidence extraction on a lumper receipt and a fuel receipt.",
        actionUrl: "/dashboard/documents",
      },
      {
        userId, title: "Detention timer running", type: "info",
        message: "Load RP-24130 has been on the clock for over 3 hours.",
        actionUrl: "/dashboard/detention", read: true,
      },
    ],
  });

  console.log(`
Done.
  Login:  ${DEMO_EMAIL} / ${DEMO_PASSWORD}
  Trucks: ${trucks.length}   Drivers: ${drivers.length}   Brokers: ${brokers.length}
  Loads:  ${loads.length}    Documents: ${documents.length}   Invoices: 3
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



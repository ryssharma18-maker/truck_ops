-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('trial', 'lite', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "TruckStatus" AS ENUM ('active', 'inactive', 'maintenance');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "LoadStatus" AS ENUM ('pending', 'in_transit', 'delivered', 'invoiced', 'paid', 'overdue');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('rate_confirmation', 'bill_of_lading', 'proof_of_delivery', 'lumper_receipt', 'fuel_receipt', 'insurance_certificate', 'w9', 'mc_authority', 'driver_license', 'other');

-- CreateEnum
CREATE TYPE "UploadSource" AS ENUM ('email', 'manual_upload', 'api');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'sent', 'submitted_to_factor', 'paid', 'overdue', 'disputed');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('check', 'ach', 'factoring', 'other');

-- CreateEnum
CREATE TYPE "DetentionStatus" AS ENUM ('active', 'completed', 'invoiced', 'paid');

-- CreateEnum
CREATE TYPE "ComplianceDocumentType" AS ENUM ('insurance', 'w9', 'mc_authority', 'dot_authority', 'driver_license', 'medical_card', 'other');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('valid', 'expiring_soon', 'expired');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('info', 'warning', 'error', 'success');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'canceled', 'past_due', 'trialing');

-- CreateEnum
CREATE TYPE "ShippingVesselStatus" AS ENUM ('active', 'in_port', 'at_sea', 'maintenance');

-- CreateEnum
CREATE TYPE "ShippingBookingStatus" AS ENUM ('pending', 'confirmed', 'loaded', 'in_transit', 'arrived', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "ShippingContainerSize" AS ENUM ('ft20', 'ft40', 'ft40hc', 'ft45');

-- CreateEnum
CREATE TYPE "ShippingContainerType" AS ENUM ('dry', 'reefer', 'open_top', 'flat_rack', 'tank');

-- CreateEnum
CREATE TYPE "ShippingManifestStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ShippingDocumentType" AS ENUM ('bill_of_lading', 'commercial_invoice', 'packing_list', 'certificate_of_origin', 'customs_declaration', 'other');

-- CreateEnum
CREATE TYPE "ShippingExtractionStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ShippingInvoiceStatus" AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "company_name" TEXT,
    "phone" TEXT,
    "dot_number" TEXT,
    "mc_number" TEXT,
    "stripe_customer_id" TEXT,
    "subscription_plan" "SubscriptionPlan" NOT NULL DEFAULT 'trial',
    "truck_count" INTEGER NOT NULL DEFAULT 1,
    "inbox_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trucks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "truck_number" TEXT NOT NULL,
    "vin" TEXT,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "license_plate" TEXT,
    "status" "TruckStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trucks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "license_number" TEXT,
    "license_expiry" DATE,
    "assigned_truck_id" UUID,
    "status" "DriverStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brokers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mc_number" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "factoring_company" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brokers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loads" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "load_number" TEXT NOT NULL,
    "broker_id" UUID,
    "truck_id" UUID,
    "driver_id" UUID,
    "shipper_name" TEXT,
    "shipper_address" TEXT,
    "consignee_name" TEXT,
    "consignee_address" TEXT,
    "pickup_date" TIMESTAMP(3),
    "delivery_date" TIMESTAMP(3),
    "actual_delivery_date" TIMESTAMP(3),
    "commodity" TEXT,
    "weight_lbs" INTEGER,
    "pallet_count" INTEGER,
    "rate_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fuel_surcharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "detention_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lumper_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_invoice_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "LoadStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "load_id" UUID,
    "document_type" "DocumentType" NOT NULL DEFAULT 'other',
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "ai_extracted_data" JSONB,
    "ai_confidence_score" DOUBLE PRECISION,
    "manually_verified" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_via" "UploadSource" NOT NULL DEFAULT 'manual_upload',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "load_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE NOT NULL,
    "bill_to_broker_id" UUID,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "detention_charges" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lumper_charges" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fuel_surcharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "pdf_url" TEXT,
    "sent_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "payment_method" "PaymentMethod",
    "factoring_company" TEXT,
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "last_reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detention_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "load_id" UUID NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "free_hours" INTEGER NOT NULL DEFAULT 2,
    "hourly_rate" DECIMAL(10,2) NOT NULL DEFAULT 50,
    "total_hours" DECIMAL(6,2),
    "total_charge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "evidence_document_ids" UUID[],
    "status" "DetentionStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detention_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_type" "ComplianceDocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "issue_date" DATE,
    "expiry_date" DATE,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 30,
    "status" "ComplianceStatus" NOT NULL DEFAULT 'valid',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "direction" "EmailDirection" NOT NULL,
    "from_email" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "subject" TEXT,
    "body_preview" TEXT,
    "related_load_id" UUID,
    "related_invoice_id" UUID,
    "attachments_count" INTEGER NOT NULL DEFAULT 0,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ifta_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "truck_id" UUID NOT NULL,
    "quarter" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "state_code" CHAR(2) NOT NULL,
    "miles" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gallons" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "tax_owed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ifta_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'info',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "action_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "truck_count" INTEGER NOT NULL,
    "monthly_amount" DECIMAL(10,2) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_vessels" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "imoNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "flag" TEXT,
    "vesselType" TEXT,
    "capacityTeu" INTEGER,
    "deadweightTons" INTEGER,
    "status" "ShippingVesselStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_vessels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_ports" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "unlocode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_ports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_bookings" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "shipperName" TEXT NOT NULL,
    "consigneeName" TEXT NOT NULL,
    "vesselId" TEXT,
    "portOfLoadingId" TEXT,
    "portOfDischargeId" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "status" "ShippingBookingStatus" NOT NULL DEFAULT 'pending',
    "freightTerms" TEXT,
    "commodity" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_containers" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "bookingId" TEXT,
    "containerNumber" TEXT NOT NULL,
    "size" "ShippingContainerSize" NOT NULL DEFAULT 'ft40',
    "type" "ShippingContainerType" NOT NULL DEFAULT 'dry',
    "sealNumber" TEXT,
    "weightKg" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_containers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_manifests" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "bookingId" TEXT NOT NULL,
    "manifestNumber" TEXT NOT NULL,
    "status" "ShippingManifestStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_documents" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "bookingId" TEXT,
    "documentType" "ShippingDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual_upload',
    "emailFrom" TEXT,
    "extractionStatus" "ShippingExtractionStatus" NOT NULL DEFAULT 'pending',
    "extractedData" JSONB,
    "confidence" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_invoices" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "bookingId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ShippingInvoiceStatus" NOT NULL DEFAULT 'draft',
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_customer_id_key" ON "users"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_inbox_email_key" ON "users"("inbox_email");

-- CreateIndex
CREATE INDEX "trucks_user_id_idx" ON "trucks"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trucks_user_id_truck_number_key" ON "trucks"("user_id", "truck_number");

-- CreateIndex
CREATE INDEX "drivers_user_id_idx" ON "drivers"("user_id");

-- CreateIndex
CREATE INDEX "brokers_user_id_idx" ON "brokers"("user_id");

-- CreateIndex
CREATE INDEX "loads_user_id_status_idx" ON "loads"("user_id", "status");

-- CreateIndex
CREATE INDEX "loads_user_id_pickup_date_idx" ON "loads"("user_id", "pickup_date");

-- CreateIndex
CREATE UNIQUE INDEX "loads_user_id_load_number_key" ON "loads"("user_id", "load_number");

-- CreateIndex
CREATE INDEX "documents_user_id_document_type_idx" ON "documents"("user_id", "document_type");

-- CreateIndex
CREATE INDEX "documents_load_id_idx" ON "documents"("load_id");

-- CreateIndex
CREATE INDEX "invoices_user_id_status_idx" ON "invoices"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_user_id_invoice_number_key" ON "invoices"("user_id", "invoice_number");

-- CreateIndex
CREATE INDEX "detention_records_user_id_status_idx" ON "detention_records"("user_id", "status");

-- CreateIndex
CREATE INDEX "compliance_documents_user_id_expiry_date_idx" ON "compliance_documents"("user_id", "expiry_date");

-- CreateIndex
CREATE INDEX "email_logs_user_id_created_at_idx" ON "email_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ifta_records_user_id_year_quarter_idx" ON "ifta_records"("user_id", "year", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "ifta_records_truck_id_year_quarter_state_code_key" ON "ifta_records"("truck_id", "year", "quarter", "state_code");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_idx" ON "notifications"("user_id", "read");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "shipping_vessels_user_id_idx" ON "shipping_vessels"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_vessels_user_id_imoNumber_key" ON "shipping_vessels"("user_id", "imoNumber");

-- CreateIndex
CREATE INDEX "shipping_ports_user_id_idx" ON "shipping_ports"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_ports_user_id_unlocode_key" ON "shipping_ports"("user_id", "unlocode");

-- CreateIndex
CREATE INDEX "shipping_bookings_user_id_idx" ON "shipping_bookings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_bookings_user_id_bookingNumber_key" ON "shipping_bookings"("user_id", "bookingNumber");

-- CreateIndex
CREATE INDEX "shipping_containers_user_id_idx" ON "shipping_containers"("user_id");

-- CreateIndex
CREATE INDEX "shipping_containers_bookingId_idx" ON "shipping_containers"("bookingId");

-- CreateIndex
CREATE INDEX "shipping_manifests_user_id_idx" ON "shipping_manifests"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_manifests_user_id_manifestNumber_key" ON "shipping_manifests"("user_id", "manifestNumber");

-- CreateIndex
CREATE INDEX "shipping_documents_user_id_idx" ON "shipping_documents"("user_id");

-- CreateIndex
CREATE INDEX "shipping_documents_bookingId_idx" ON "shipping_documents"("bookingId");

-- CreateIndex
CREATE INDEX "shipping_invoices_user_id_idx" ON "shipping_invoices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_invoices_user_id_invoiceNumber_key" ON "shipping_invoices"("user_id", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_assigned_truck_id_fkey" FOREIGN KEY ("assigned_truck_id") REFERENCES "trucks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokers" ADD CONSTRAINT "brokers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bill_to_broker_id_fkey" FOREIGN KEY ("bill_to_broker_id") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detention_records" ADD CONSTRAINT "detention_records_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detention_records" ADD CONSTRAINT "detention_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ifta_records" ADD CONSTRAINT "ifta_records_truck_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ifta_records" ADD CONSTRAINT "ifta_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_vessels" ADD CONSTRAINT "shipping_vessels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_ports" ADD CONSTRAINT "shipping_ports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_bookings" ADD CONSTRAINT "shipping_bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_bookings" ADD CONSTRAINT "shipping_bookings_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "shipping_vessels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_bookings" ADD CONSTRAINT "shipping_bookings_portOfLoadingId_fkey" FOREIGN KEY ("portOfLoadingId") REFERENCES "shipping_ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_bookings" ADD CONSTRAINT "shipping_bookings_portOfDischargeId_fkey" FOREIGN KEY ("portOfDischargeId") REFERENCES "shipping_ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_containers" ADD CONSTRAINT "shipping_containers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_containers" ADD CONSTRAINT "shipping_containers_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "shipping_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_manifests" ADD CONSTRAINT "shipping_manifests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_manifests" ADD CONSTRAINT "shipping_manifests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "shipping_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_documents" ADD CONSTRAINT "shipping_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_documents" ADD CONSTRAINT "shipping_documents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "shipping_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_invoices" ADD CONSTRAINT "shipping_invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_invoices" ADD CONSTRAINT "shipping_invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "shipping_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;


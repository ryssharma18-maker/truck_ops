import { PageSkeleton } from "@/components/ui/feedback";

/**
 * Segment-level loading state. Every page in this segment queries Prisma
 * directly, and a cold pooler handshake on this network takes seconds, so this
 * is what the user sees instead of a blank page.
 */
export default function Loading() {
  return <PageSkeleton />;
}

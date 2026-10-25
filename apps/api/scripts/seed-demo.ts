import { createPrisma } from "@blindcount/db";

/**
 * Creates clearly labelled demo identities and a simulated programme. Cohort creation,
 * criterion, roster and publishing are left to the live demo so every chain transaction
 * in the walkthrough is real and attributable.
 */
const prisma = createPrisma(process.env.DATABASE_URL);
const now = new Date();
const people = [
  { email: "manager@demo.blindcount.test", displayName: "Demo Manager (simulated)", roles: ["OWNER", "MANAGER", "CUSTODIAN"] as const },
  { email: "auditor.a@demo.blindcount.test", displayName: "Demo Auditor A (simulated)", roles: ["AUDITOR"] as const },
  { email: "auditor.b@demo.blindcount.test", displayName: "Demo Auditor B (simulated)", roles: ["AUDITOR"] as const },
  { email: "reviewer@demo.blindcount.test", displayName: "Demo Reviewer (simulated)", roles: ["REVIEWER"] as const },
];

const existing = await prisma.organization.findFirst({ where: { name: "BlindCount Demo Programme (SIMULATED)" } });
if (existing) {
  console.log(`demo organization already exists: ${existing.id}`);
  process.exit(0);
}
const org = await prisma.organization.create({ data: { name: "BlindCount Demo Programme (SIMULATED)", countryCode: "CI", timeZone: "Africa/Abidjan" } });
for (const p of people) {
  const user = await prisma.user.upsert({ where: { email: p.email }, create: { email: p.email, displayName: p.displayName, emailVerifiedAt: now }, update: {} });
  await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, roles: [...p.roles] } });
}
const year = now.getFullYear();
await prisma.programme.create({
  data: {
    organizationId: org.id,
    code: `DEMO-${year}`,
    name: `Shade Tree Monitoring ${year} (demo)`,
    crop: "Cocoa",
    regionLabel: "Simulated region",
    purpose: "Demonstrate blind shade-tree counts. All farms, people and counts are simulated.",
    startAt: new Date(`${year}-01-01`),
    endAt: new Date(`${year}-12-31`),
    dataSource: "SIMULATED_DEMO",
  },
});
await prisma.auditEvent.create({ data: { organizationId: org.id, actorType: "system", action: "demo.seeded", objectType: "organization", objectId: org.id, traceId: crypto.randomUUID() } });
console.log(`seeded demo organization ${org.id}`);
console.log(`sign in as any of: ${people.map((p) => p.email).join(", ")} (codes go to storage/outbox.log locally)`);
await prisma.$disconnect();

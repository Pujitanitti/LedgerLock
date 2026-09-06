/**
 * Ledger-Lock seed script.
 *
 * Seeds two tenants (Acme, Globex), each with:
 *   - one API key (printed once, at seed time)
 *   - one demo end-user ("demo-user")
 *   - one permission ("documents:read")
 *   - one role ("Member") granting that permission
 *   - the demo user assigned to that role
 *
 * This is enough to demonstrate one real, end-to-end ALLOW decision via
 * POST /v1/check immediately after seeding — see README.md's "Try it"
 * section for the exact request. ABAC policies, role inheritance, and
 * additional demo data are deliberately NOT seeded here: this script
 * aims for the smallest deterministic dataset that exercises the real
 * authorization system, not a full demo dataset.
 *
 * Uses PrismaClient directly (the same pattern as the rest of this
 * script always has) rather than bootstrapping the NestJS application —
 * this is standard practice for seed scripts and still writes through
 * the exact same schema/tables the running application reads, so the
 * seeded data exercises the real authorization system, not a shortcut
 * around it.
 *
 * The raw keys are printed to the console once, at seed time. This is
 * NOT an application log (nothing in the running service ever logs a raw
 * key — see ApiKeyService) — it is a one-time interactive developer
 * bootstrap output, the same category as printing a locally generated
 * password during initial setup. These keys only ever exist against a
 * developer's own local database.
 */
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { generateApiKey, hashApiKeySecret } from '../apps/api/src/auth/crypto/api-key-crypto';

const prisma = new PrismaClient();

const DEMO_EXTERNAL_USER_ID = 'demo-user';
const DEMO_PERMISSION_ACTION = 'documents:read';
const DEMO_ROLE_NAME = 'Member';

async function seedTenantWithApiKey(slug: string, name: string): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, name },
  });

  const existingKeys = await prisma.apiKey.count({ where: { tenantId: tenant.id } });
  if (existingKeys === 0) {
    // Development-only pepper fallback so this script can run before a
    // real .env is configured; production must always set
    // API_KEY_HMAC_PEPPER.
    const pepper = process.env.API_KEY_HMAC_PEPPER ?? randomBytes(32).toString('hex');
    const generated = generateApiKey();
    const secretHash = hashApiKeySecret(generated.secret, pepper);

    await prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        publicId: generated.publicId,
        secretHash,
        name: 'Seed key (development only)',
      },
    });

    console.log(`Tenant "${slug}" seeded. Development API key (shown once):`);
    console.log(`  ${generated.raw}`);
  } else {
    console.log(`Tenant "${slug}" already has an API key — skipping key creation.`);
  }

  await seedRbacDemoData(tenant.id, slug);
}

/**
 * Seeds exactly enough RBAC state to demonstrate one real ALLOW decision:
 * a "Member" role granting "documents:read", assigned to a demo user.
 * Idempotent — safe to re-run against an already-seeded database.
 */
async function seedRbacDemoData(tenantId: string, slug: string): Promise<void> {
  const user = await prisma.user.upsert({
    where: { tenantId_externalId: { tenantId, externalId: DEMO_EXTERNAL_USER_ID } },
    update: {},
    create: { tenantId, externalId: DEMO_EXTERNAL_USER_ID },
  });

  const permission = await prisma.permission.upsert({
    where: { tenantId_action: { tenantId, action: DEMO_PERMISSION_ACTION } },
    update: {},
    create: { tenantId, action: DEMO_PERMISSION_ACTION },
  });

  const role = await prisma.role.upsert({
    where: { tenantId_name: { tenantId, name: DEMO_ROLE_NAME } },
    update: {},
    create: { tenantId, name: DEMO_ROLE_NAME },
  });

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: {},
    create: { roleId: role.id, permissionId: permission.id },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });

  console.log(
    `Tenant "${slug}": seeded user "${DEMO_EXTERNAL_USER_ID}" with role "${DEMO_ROLE_NAME}" ` +
      `granting "${DEMO_PERMISSION_ACTION}".`,
  );
}

async function main(): Promise<void> {
  await seedTenantWithApiKey('acme', 'Acme Inc.');
  await seedTenantWithApiKey('globex', 'Globex Corporation');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Database seed — idempotent. Safe to re-run.
 *
 *   pnpm --filter api prisma:seed
 *
 * Creates:
 *   1. Platform admin: ruanv@openvantage.co.za (PLATFORM_ADMIN, system org owner)
 *   2. Demo org admin: ruan15viljoen@gmail.com (USER, org owner of "Demo Organisation")
 *   3. "Demo Organisation" with a "Demo Project"
 *   4. Three environments (LOCAL, STAGING, UAT) so both manual + auto runs work
 *   5. One module ("Account Management") with 2 features:
 *        - Account Registration (4 tests)
 *        - Account Login (4 tests)
 *   6. Each test ships with proper Playwright step JSON so it runs end-to-end
 *      AS-IS in AUTOMATED mode, AND each step has a human-readable `name` so
 *      it reads sensibly in MANUAL mode (description-driven runner).
 *
 * All passwords are `Demo123!` — safe to publish in dev / staging only.
 * Rotate before any production-adjacent use.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ─── Constants ───────────────────────────────────────────────────────────────

const PLATFORM_ADMIN_EMAIL = 'ruanv@openvantage.co.za';
const PLATFORM_ADMIN_NAME = 'Ruan Viljoen';

const DEMO_ORG_ADMIN_EMAIL = 'ruan15viljoen@gmail.com';
const DEMO_ORG_ADMIN_NAME = 'Ruan Viljoen (Demo)';

const SHARED_PASSWORD = 'Demo123!';

const SYSTEM_ORG_NAME = 'System';
const SYSTEM_ORG_SLUG = 'system';

const DEMO_ORG_NAME = 'Demo Organisation';
const DEMO_ORG_SLUG = 'demo-organisation';

const DEMO_PROJECT_NAME = 'Demo Project';
const DEMO_PROJECT_SLUG = 'demo-project';

// ─── Step builders ───────────────────────────────────────────────────────────
//
// Steps follow the canonical schema in docs/STEP_DEFINITION_SPEC.md. Each step
// carries enough metadata for Playwright to execute it AND a `name` that reads
// clearly to a human tester walking through manually.

type Step = {
  id: string;
  type: string;
  name: string;
  input?: Record<string, string | number>;
};

let stepCounter = 0;
const stepId = () => `step-${++stepCounter}`;

const navigate = (path: string, name?: string): Step => ({
  id: stepId(),
  type: 'NAVIGATE',
  name: name ?? `Open ${path}`,
  input: { url: path },
});

const waitForSelector = (selector: string, name: string): Step => ({
  id: stepId(),
  type: 'WAIT_FOR_SELECTOR',
  name,
  input: { selector, timeout: 5000 },
});

const fill = (selector: string, value: string, name: string): Step => ({
  id: stepId(),
  type: 'FILL',
  name,
  input: { selector, value },
});

const select = (selector: string, value: string, name: string): Step => ({
  id: stepId(),
  type: 'SELECT',
  name,
  input: { selector, value },
});

const click = (selector: string, name: string): Step => ({
  id: stepId(),
  type: 'CLICK',
  name,
  input: { selector },
});

const expectText = (selector: string, text: string, name: string): Step => ({
  id: stepId(),
  type: 'ASSERT_TEXT',
  name,
  input: { selector, text },
});

const expectVisible = (selector: string, name: string): Step => ({
  id: stepId(),
  type: 'ASSERT_VISIBLE',
  name,
  input: { selector },
});

// ─── Test definitions ────────────────────────────────────────────────────────

const REGISTRATION_TESTS = [
  {
    name: 'Successful registration with valid details',
    description:
      'A new user fills in name + email + password with all valid values and submits. The app should accept the submission and route to the post-signup confirmation page.',
    tags: ['registration', 'happy-path'],
    steps: [
      navigate('/register', 'Open registration page'),
      waitForSelector('#input-reg-email', 'Confirm registration form is visible'),
      fill('#input-name', 'Demo User', 'Enter the user\'s name'),
      fill('#input-reg-email', `demo+${Date.now()}@example.com`, 'Enter a fresh, valid email'),
      fill('#input-reg-password', 'StrongPass123!', 'Enter a valid password'),
      select('#select-country', 'South Africa', 'Select a country'),
      click('#btn-register', 'Submit the registration form'),
      expectVisible('#register-success', 'Confirm the success state appears'),
    ],
  },
  {
    name: 'Registration requires a country',
    legacyNames: ['Registration rejects duplicate email'],
    description:
      'The form should reject otherwise valid registration details when no country is selected.',
    tags: ['registration', 'validation'],
    steps: [
      navigate('/register', 'Open registration page'),
      fill('#input-name', 'Country Tester', 'Enter the user\'s name'),
      fill('#input-reg-email', `country+${Date.now()}@example.com`, 'Enter a fresh email'),
      fill('#input-reg-password', 'StrongPass123!', 'Enter a valid password'),
      click('#btn-register', 'Attempt to submit without a country'),
      expectText('#error-country', 'Please select a country', 'Confirm the country-required error'),
    ],
  },
  {
    name: 'Registration rejects weak password',
    description:
      'Passwords must meet the complexity rules (length, mixed case, digit). A short or simple password should be rejected before the form even submits.',
    tags: ['registration', 'validation'],
    steps: [
      navigate('/register', 'Open registration page'),
      fill('#input-name', 'Weak Pass Tester', 'Enter the user\'s name'),
      fill('#input-reg-email', `weak+${Date.now()}@example.com`, 'Enter a fresh email'),
      fill('#input-reg-password', '123', 'Enter a deliberately weak password'),
      select('#select-country', 'South Africa', 'Select a country'),
      click('#btn-register', 'Attempt to submit'),
      expectText('#error-password', 'Password must be 8+ characters', 'Confirm the weak-password error message'),
    ],
  },
  {
    name: 'Registration requires an email',
    legacyNames: ['Registration form validates email format'],
    description:
      'Submitting the registration form without an email should show the application email validation message.',
    tags: ['registration', 'validation'],
    steps: [
      navigate('/register', 'Open registration page'),
      fill('#input-name', 'Missing Email Tester', 'Enter the user\'s name'),
      fill('#input-reg-password', 'StrongPass123!', 'Enter a valid password'),
      select('#select-country', 'South Africa', 'Select a country'),
      click('#btn-register', 'Attempt to submit'),
      expectText('#error-email', 'Valid email required', 'Confirm the email-required error appears'),
    ],
  },
];

const LOGIN_TESTS = [
  {
    name: 'Successful login with valid credentials',
    description:
      'An active user with the correct password should sign in cleanly and land on the dashboard.',
    tags: ['login', 'happy-path'],
    steps: [
      navigate('/login', 'Open login page'),
      waitForSelector('#input-email', 'Confirm login form is visible'),
      fill('#input-email', 'test@example.com', 'Enter the documented test email'),
      fill('#input-password', 'password', 'Enter the documented test password'),
      click('#btn-login', 'Submit login'),
      waitForSelector('#page-products', 'Confirm the products page appears'),
    ],
  },
  {
    name: 'Login rejects wrong password',
    description:
      'A real email paired with the wrong password should fail with a generic "invalid credentials" error — never reveal whether the email exists.',
    tags: ['login', 'security'],
    steps: [
      navigate('/login', 'Open login page'),
      fill('#input-email', 'test@example.com', 'Enter the documented test email'),
      fill('#input-password', 'wrong-password', 'Enter an incorrect password'),
      click('#btn-login', 'Submit login'),
      expectText('#login-error', 'Invalid credentials', 'Confirm the generic invalid-credentials error'),
    ],
  },
  {
    name: 'Login rejects unknown email with same generic error',
    description:
      'An email that does not exist should produce the SAME error as a wrong password — anything more specific leaks user existence.',
    tags: ['login', 'security'],
    steps: [
      navigate('/login', 'Open login page'),
      fill('#input-email', 'nobody-here@example.com', 'Enter an email that does not exist'),
      fill('#input-password', 'AnyPassword1!', 'Enter any password'),
      click('#btn-login', 'Submit login'),
      expectText('#login-error', 'Invalid credentials', 'Confirm the same generic error appears (no email-existence leak)'),
    ],
  },
  {
    name: 'Login form blocks submission with empty fields',
    description:
      'Submitting an empty form should block the request client-side and highlight the missing fields.',
    tags: ['login', 'validation'],
    steps: [
      navigate('/login', 'Open login page'),
      click('#btn-login', 'Click submit without filling anything'),
      expectText('#login-error', 'Email is required', 'Confirm the email-required message'),
    ],
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding QA Platform demo data...');
  console.log('');

  const passwordHash = await bcrypt.hash(SHARED_PASSWORD, 12);

  // ── 1. Platform admin (ruanv@openvantage.co.za) ────────────────────────────
  const platformAdmin = await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN_EMAIL },
    create: {
      email: PLATFORM_ADMIN_EMAIL,
      name: PLATFORM_ADMIN_NAME,
      passwordHash,
      platformRole: 'PLATFORM_ADMIN',
      accountStatus: 'ACTIVE',
    },
    update: {
      platformRole: 'PLATFORM_ADMIN',
      accountStatus: 'ACTIVE',
      passwordHash,
    },
  });
  console.log(`✓  Platform admin: ${platformAdmin.email}`);

  // ── 2. System org (owned by platform admin, where they live by default) ────
  const systemOrg = await prisma.organisation.upsert({
    where: { slug: SYSTEM_ORG_SLUG },
    create: {
      name: SYSTEM_ORG_NAME,
      slug: SYSTEM_ORG_SLUG,
      description: 'Platform system organisation',
      ownerId: platformAdmin.id,
    },
    update: { ownerId: platformAdmin.id },
  });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: systemOrg.id, userId: platformAdmin.id } },
    create: { orgId: systemOrg.id, userId: platformAdmin.id, role: 'ORG_ADMIN' },
    update: { role: 'ORG_ADMIN' },
  });

  await prisma.user.update({
    where: { id: platformAdmin.id },
    data: { lastActiveOrgId: platformAdmin.lastActiveOrgId ?? systemOrg.id },
  });

  // ── 3. Demo org admin (ruan15viljoen@gmail.com) ────────────────────────────
  const demoAdmin = await prisma.user.upsert({
    where: { email: DEMO_ORG_ADMIN_EMAIL },
    create: {
      email: DEMO_ORG_ADMIN_EMAIL,
      name: DEMO_ORG_ADMIN_NAME,
      passwordHash,
      platformRole: 'USER',
      accountStatus: 'ACTIVE',
    },
    update: {
      passwordHash,
      accountStatus: 'ACTIVE',
    },
  });
  console.log(`✓  Demo org admin: ${demoAdmin.email}`);

  // ── 4. Demo organisation owned by demo admin ───────────────────────────────
  const demoOrg = await prisma.organisation.upsert({
    where: { slug: DEMO_ORG_SLUG },
    create: {
      name: DEMO_ORG_NAME,
      slug: DEMO_ORG_SLUG,
      description: 'Demo data — sample project, module, features, and tests for hands-on exploration.',
      ownerId: demoAdmin.id,
    },
    update: { ownerId: demoAdmin.id },
  });
  console.log(`✓  Demo org: ${demoOrg.name}`);

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: demoOrg.id, userId: demoAdmin.id } },
    create: { orgId: demoOrg.id, userId: demoAdmin.id, role: 'ORG_ADMIN' },
    update: { role: 'ORG_ADMIN' },
  });

  // Platform admin gets ORG_ADMIN access to the demo org too — useful for
  // support / debugging without needing to log out.
  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: demoOrg.id, userId: platformAdmin.id } },
    create: { orgId: demoOrg.id, userId: platformAdmin.id, role: 'ORG_ADMIN' },
    update: { role: 'ORG_ADMIN' },
  });

  await prisma.user.update({
    where: { id: demoAdmin.id },
    data: { lastActiveOrgId: demoAdmin.lastActiveOrgId ?? demoOrg.id },
  });

  // ── 5. Demo project ────────────────────────────────────────────────────────
  const demoProject = await prisma.project.upsert({
    // Project slug is unique per-org (@@unique([orgId, slug])), not globally.
    where: { orgId_slug: { orgId: demoOrg.id, slug: DEMO_PROJECT_SLUG } },
    create: {
      name: DEMO_PROJECT_NAME,
      slug: DEMO_PROJECT_SLUG,
      description: 'Walks through account registration + login flows. Use the bundled /testapp environment as the target.',
      ownerId: demoAdmin.id,
      orgId: demoOrg.id,
    },
    update: {
      ownerId: demoAdmin.id,
      orgId: demoOrg.id,
    },
  });
  console.log(`✓  Demo project: ${demoProject.name}`);

  // Demo admin owns the project; platform admin has TECH_LEAD access for
  // hands-off observation without inheriting OWNER privileges.
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: demoProject.id, userId: demoAdmin.id } },
    create: { projectId: demoProject.id, userId: demoAdmin.id, role: 'OWNER' },
    update: { role: 'OWNER' },
  });
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: demoProject.id, userId: platformAdmin.id } },
    create: { projectId: demoProject.id, userId: platformAdmin.id, role: 'TECH_LEAD' },
    update: { role: 'TECH_LEAD' },
  });

  // ── 6. Environments — three to demonstrate phase progression ───────────────
  // The bundled /testapp lives at the same origin as the platform, so we
  // point UAT/STAGING at it. Override these later in Project → Environments
  // to point at your real app.
  const envs = [
    { name: 'Local', type: 'LOCAL' as const, baseUrl: 'http://localhost:3000/testapp', supportsAutomation: true },
    { name: 'Staging', type: 'STAGING' as const, baseUrl: 'http://localhost:3000/testapp', supportsAutomation: true },
    { name: 'UAT', type: 'STAGING' as const, baseUrl: 'http://localhost:3000/testapp', supportsAutomation: true },
  ];
  for (const env of envs) {
    const existing = await prisma.environment.findFirst({
      where: { projectId: demoProject.id, name: env.name },
    });
    if (existing) {
      await prisma.environment.update({
        where: { id: existing.id },
        data: { type: env.type, baseUrl: env.baseUrl, supportsAutomation: env.supportsAutomation },
      });
    } else {
      await prisma.environment.create({
        data: { ...env, projectId: demoProject.id },
      });
    }
  }
  console.log(`✓  ${envs.length} environments`);

  // ── 7. Module ──────────────────────────────────────────────────────────────
  let module = await prisma.module.findFirst({
    where: { projectId: demoProject.id, name: 'Account Management' },
  });
  if (!module) {
    module = await prisma.module.create({
      data: {
        projectId: demoProject.id,
        name: 'Account Management',
        description: 'Sign-up, sign-in, and credential lifecycle.',
        order: 0,
        tags: ['demo', 'auth'],
      },
    });
  }
  console.log(`✓  Module: ${module.name}`);

  // ── 8. Features + tests ────────────────────────────────────────────────────
  // Created with isActive=true and isDraft=false so they're immediately
  // runnable in either MANUAL or AUTOMATED mode.
  const features = [
    {
      name: 'Account Registration',
      description: 'Covers the new-user signup flow: form validation, error handling, and the happy path.',
      order: 0,
      tests: REGISTRATION_TESTS,
    },
    {
      name: 'Account Login',
      description: 'Covers the returning-user login flow: valid credentials, security-conscious error messaging, and form validation.',
      order: 1,
      tests: LOGIN_TESTS,
    },
  ];

  for (const f of features) {
    let feature = await prisma.feature.findFirst({
      where: { moduleId: module.id, name: f.name },
    });
    if (!feature) {
      feature = await prisma.feature.create({
        data: {
          moduleId: module.id,
          name: f.name,
          description: f.description,
          order: f.order,
          isActive: true,
          isDraft: false,
        },
      });
    } else {
      feature = await prisma.feature.update({
        where: { id: feature.id },
        data: { description: f.description, isDraft: false, isActive: true },
      });
    }

    for (const t of f.tests) {
      const legacyNames = 'legacyNames' in t ? t.legacyNames as string[] : [];
      const names = [t.name, ...legacyNames];
      const existing = await prisma.testDefinition.findFirst({
        where: { featureId: feature.id, name: { in: names } },
      });
      if (existing) {
        await prisma.testDefinition.update({
          where: { id: existing.id },
          data: {
            name: t.name,
            description: t.description,
            tags: t.tags,
            steps: t.steps as object,
          },
        });
      } else {
        await prisma.testDefinition.create({
          data: {
            projectId: demoProject.id,
            featureId: feature.id,
            name: t.name,
            description: t.description,
            type: 'UI',
            tags: t.tags,
            steps: t.steps as object,
            isActive: true,
          },
        });
      }
    }
    console.log(`   - ${f.name} (${f.tests.length} tests)`);
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Seed complete. Login credentials (password: Demo123!)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Platform admin: ${PLATFORM_ADMIN_EMAIL}`);
  console.log(`  Demo org admin: ${DEMO_ORG_ADMIN_EMAIL}`);
  console.log('');
  console.log('Demo data:');
  console.log(`  Org:     ${DEMO_ORG_NAME}`);
  console.log(`  Project: ${DEMO_PROJECT_NAME}`);
  console.log(`  Module:  Account Management`);
  console.log(`  Features:`);
  console.log(`    - Account Registration (4 tests)`);
  console.log(`    - Account Login        (4 tests)`);
  console.log('');
  console.log('Tests support both MANUAL and AUTOMATED modes — each step has');
  console.log('a human-readable name (manual) AND proper Playwright params (auto).');
  console.log('');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

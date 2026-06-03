import type { PrismaService } from '../prisma/prisma.service';

export interface FailureMentionContext {
  runId: string;
  projectId: string;
  testDefinitionId: string;
  featureId: string | null;
  orgId: string | null;
  testName: string;
}

/**
 * Notify QA users @-mentioned in a test's failure reason. Resolves @slug →
 * project member (email-prefix or slugified name), then creates an in-app
 * notification that deep-links straight to the test in Testing Mode. Shared by
 * the manual-run mark path and the feature-page quick-mark so the "@name to
 * notify" affordance behaves the same everywhere. Best-effort — callers wrap
 * in try/catch so a notification hiccup never blocks the verdict.
 */
export async function notifyFailureMentions(
  prisma: PrismaService,
  ctx: FailureMentionContext,
  note: string,
  actorId: string,
): Promise<void> {
  const slugs = [...new Set(
    [...note.matchAll(/(^|[^a-z0-9_])@([a-z0-9_.-]+)/gi)].map((m) => m[2].toLowerCase()),
  )].slice(0, 10);
  if (slugs.length === 0 || !ctx.featureId || !ctx.orgId) return;

  const members = await prisma.projectMember.findMany({
    where: { projectId: ctx.projectId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const resolved = slugs
    .map((slug) => members.find((m) =>
      (m.user.email?.split('@')[0].toLowerCase() === slug) ||
      m.user.name.toLowerCase().replace(/\s+/g, '-') === slug,
    )?.user)
    .filter((u): u is { id: string; name: string; email: string } => !!u)
    .filter((u) => u.id !== actorId)
    .filter((u, i, arr) => arr.findIndex((x) => x.id === u.id) === i);
  if (resolved.length === 0) return;

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
  const actionUrl = `/projects/${ctx.projectId}/features/${ctx.featureId}/test?testCaseId=${ctx.testDefinitionId}`;
  await prisma.notification.createMany({
    data: resolved.map((u) => ({
      userId: u.id,
      orgId: ctx.orgId!,
      type: 'TEST_FAILURE_MENTIONED' as const,
      category: 'ASSIGNMENT' as const,
      title: `${actor?.name ?? 'Someone'} mentioned you in failed test "${ctx.testName}"`,
      body: note.slice(0, 140),
      actionUrl,
      actionLabel: 'Open test',
      meta: { testRunId: ctx.runId, testDefinitionId: ctx.testDefinitionId, featureId: ctx.featureId, actorId },
    })),
    skipDuplicates: true,
  });
}

import { DefectStatus, PrismaClient, StepType, TriageBucket } from '@prisma/client';

type FailureMatchInput = {
  projectId: string;
  testRunId: string;
  runStepId: string;
  message: string;
  stepType: StepType;
  triageBucket: TriageBucket | null;
};

/** Apply persisted project defect rules after a failed step is written. */
export async function matchDefectsForFailure(prisma: PrismaClient, input: FailureMatchInput): Promise<void> {
  const candidates = await prisma.defect.findMany({
    where: { projectId: input.projectId, status: DefectStatus.OPEN },
    select: { id: true, messagePattern: true, stackPattern: true, stepTypeIn: true, category: true },
  });
  const message = input.message.slice(0, 4_000);
  const matched = candidates.filter(defect => {
    try {
      if (defect.messagePattern && !new RegExp(defect.messagePattern).test(message)) return false;
      // Stack is currently stored in Playwright's error message. Keep the
      // separate rule field so a structured stack can be supplied later.
      if (defect.stackPattern && !new RegExp(defect.stackPattern).test(message)) return false;
      if (defect.stepTypeIn.length > 0 && !defect.stepTypeIn.includes(input.stepType)) return false;
      if (defect.category && defect.category !== input.triageBucket) return false;
      return true;
    } catch {
      return false;
    }
  });
  if (matched.length === 0) return;
  await prisma.$transaction([
    ...matched.map(defect => prisma.defectMatch.upsert({
      where: { defectId_runStepId: { defectId: defect.id, runStepId: input.runStepId } },
      create: { defectId: defect.id, testRunId: input.testRunId, runStepId: input.runStepId },
      update: {},
    })),
    prisma.runStep.update({
      where: { id: input.runStepId },
      data: { resolution: 'DEFECT', resolvedAt: new Date() },
    }),
  ]);
}

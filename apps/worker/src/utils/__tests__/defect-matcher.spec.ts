import { matchDefectsForFailure } from '../defect-matcher';

describe('matchDefectsForFailure', () => {
  const makePrisma = (defects: Array<Record<string, unknown>>) => {
    const upsert = jest.fn();
    const update = jest.fn();
    return {
      defect: { findMany: jest.fn().mockResolvedValue(defects) },
      defectMatch: { upsert },
      runStep: { update },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as Parameters<typeof matchDefectsForFailure>[0] & {
      defect: { findMany: jest.Mock };
      defectMatch: { upsert: jest.Mock };
      runStep: { update: jest.Mock };
      $transaction: jest.Mock;
    };
  };

  const input = {
    projectId: 'project-1', testRunId: 'run-1', runStepId: 'step-1',
    message: 'locator #checkout was not found', stepType: 'CLICK' as const,
    triageBucket: 'AUTOMATION' as const,
  };

  it('writes a match and resolves the step when every configured rule matches', async () => {
    const prisma = makePrisma([{
      id: 'defect-1', messagePattern: 'checkout.*not found', stackPattern: null,
      stepTypeIn: ['CLICK'], category: 'AUTOMATION',
    }]);

    await matchDefectsForFailure(prisma, input);

    expect(prisma.defectMatch.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { defectId_runStepId: { defectId: 'defect-1', runStepId: 'step-1' } },
    }));
    expect(prisma.runStep.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resolution: 'DEFECT' }),
    }));
  });

  it('does not resolve a step when a structured rule does not match', async () => {
    const prisma = makePrisma([{
      id: 'defect-1', messagePattern: 'payment gateway', stackPattern: null,
      stepTypeIn: [], category: null,
    }]);

    await matchDefectsForFailure(prisma, input);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

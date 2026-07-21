import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SelectorHealsService } from '../selector-heals.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TestsService } from '../../tests/tests.service';

const pendingHeal = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'heal-1',
  stepIndex: 2,
  stepName: 'Click login',
  originalSelector: '#stale-login-btn',
  healedSelector: '[data-testid="login"]',
  confidence: 'high',
  strategy: 'testattr',
  eligibleForPromotion: true,
  promoted: false,
  testDefinitionId: 'test-1',
  ...over,
});

const mockPrisma = {
  selectorHeal: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  testDefinition: { findUnique: jest.fn() },
  project: { findUnique: jest.fn(), update: jest.fn() },
  testRun: { findUnique: jest.fn(), findMany: jest.fn() },
};
const mockTests = { update: jest.fn() };

describe('SelectorHealsService', () => {
  let service: SelectorHealsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelectorHealsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TestsService, useValue: mockTests },
      ],
    }).compile();
    service = module.get(SelectorHealsService);
  });

  describe('listPending', () => {
    it('filters to eligible, not-yet-promoted heals for the project', async () => {
      mockPrisma.selectorHeal.findMany.mockResolvedValue([pendingHeal()]);
      const result = await service.listPending('proj-1');
      expect(mockPrisma.selectorHeal.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { promoted: false, eligibleForPromotion: true, testDefinition: { projectId: 'proj-1' } },
      }));
      expect(result).toHaveLength(1);
    });
  });

  describe('projectIdOf', () => {
    it('404s for an unknown heal', async () => {
      mockPrisma.selectorHeal.findUnique.mockResolvedValue(null);
      await expect(service.projectIdOf('nope')).rejects.toThrow(NotFoundException);
    });

    it('resolves via the owning test definition', async () => {
      mockPrisma.selectorHeal.findUnique.mockResolvedValue({ testDefinition: { projectId: 'proj-1' } });
      await expect(service.projectIdOf('heal-1')).resolves.toBe('proj-1');
    });
  });

  describe('promote', () => {
    it('404s for an unknown heal', async () => {
      mockPrisma.selectorHeal.findUnique.mockResolvedValue(null);
      await expect(service.promote('nope')).rejects.toThrow(NotFoundException);
    });

    it('409s if already promoted', async () => {
      mockPrisma.selectorHeal.findUnique.mockResolvedValue(pendingHeal({ promoted: true }));
      await expect(service.promote('heal-1')).rejects.toThrow(ConflictException);
    });

    it('409s if not eligible (the owning run has not finished cleanly)', async () => {
      mockPrisma.selectorHeal.findUnique.mockResolvedValue(pendingHeal({ eligibleForPromotion: false }));
      await expect(service.promote('heal-1')).rejects.toThrow(ConflictException);
    });

    it('sets the healed selector as primary and demotes the old primary into fallbacks', async () => {
      // TestDefinition.steps has no stored `index` — position in the array
      // IS the index (the same convention run.executor.ts uses). No `index`
      // field here on purpose: a fixture that includes one would validate
      // the wrong mental model instead of the real data shape.
      mockPrisma.selectorHeal.findUnique.mockResolvedValue(pendingHeal());
      mockPrisma.testDefinition.findUnique.mockResolvedValue({
        id: 'test-1',
        steps: [
          { type: 'NAVIGATE', input: { url: '/login' } },
          { type: 'FILL', input: { selector: '#email' } },
          { type: 'CLICK', input: { selector: '#stale-login-btn', fallbackSelectors: ['[data-testid="login"]', '.btn-alt'] } },
        ],
      });
      mockTests.update.mockResolvedValue({});
      mockPrisma.selectorHeal.update.mockResolvedValue({});

      await service.promote('heal-1', 'user-1');

      const [testDefId, dto] = mockTests.update.mock.calls[0];
      expect(testDefId).toBe('test-1');
      const steps = dto.steps as Array<{ input: Record<string, unknown> }>;
      expect(steps[2].input.selector).toBe('[data-testid="login"]');
      // Old primary demoted to the FRONT of fallbacks; the already-healed
      // selector removed from the fallback list (it's primary now).
      expect(steps[2].input.fallbackSelectors).toEqual(['#stale-login-btn', '.btn-alt']);
      // Steps 0 and 1 untouched.
      expect(steps[0].input).toEqual({ url: '/login' });

      expect(mockPrisma.selectorHeal.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'heal-1' },
        data: expect.objectContaining({ promoted: true, promotedById: 'user-1' }),
      }));
    });

    it('409s if the step no longer exists on the test', async () => {
      mockPrisma.selectorHeal.findUnique.mockResolvedValue(pendingHeal({ stepIndex: 99 }));
      mockPrisma.testDefinition.findUnique.mockResolvedValue({ id: 'test-1', steps: [{ input: {} }] });
      await expect(service.promote('heal-1')).rejects.toThrow(ConflictException);
      expect(mockTests.update).not.toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('clears eligibility without touching the stored step', async () => {
      mockPrisma.selectorHeal.findUnique.mockResolvedValue(pendingHeal());
      mockPrisma.selectorHeal.update.mockResolvedValue({});
      await service.dismiss('heal-1');
      expect(mockPrisma.selectorHeal.update).toHaveBeenCalledWith({
        where: { id: 'heal-1' }, data: { eligibleForPromotion: false },
      });
      expect(mockTests.update).not.toHaveBeenCalled();
    });

    it('409s if already promoted', async () => {
      mockPrisma.selectorHeal.findUnique.mockResolvedValue(pendingHeal({ promoted: true }));
      await expect(service.dismiss('heal-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('evaluateCompletedRun', () => {
    const corroboratedRun = {
      status: 'PASSED',
      steps: [{
        status: 'PASSED_HEALED',
        selectorHeals: [{ healedSelector: '[data-testid="login"]', strategy: 'testattr' }],
      }],
    };

    beforeEach(() => {
      mockPrisma.testRun.findUnique.mockResolvedValue({
        status: 'PASSED', runMode: 'AUTOMATED', isPreview: false,
      });
      mockPrisma.selectorHeal.findMany.mockResolvedValue([pendingHeal({
        runId: 'run-1',
        testDefinition: {
          project: { selectorHealAutoApply: false, selectorHealPromotionRuns: 3 },
        },
      })]);
      mockPrisma.selectorHeal.updateMany.mockResolvedValue({ count: 1 });
    });

    it('requires every one of the configured recent runs to use the same fallback', async () => {
      mockPrisma.testRun.findMany.mockResolvedValue([
        corroboratedRun,
        { ...corroboratedRun, steps: [{ status: 'PASSED_HEALED', selectorHeals: [{ healedSelector: '.different-fallback', strategy: 'css' }] }] },
        corroboratedRun,
      ]);

      await service.evaluateCompletedRun('run-1');

      expect(mockPrisma.selectorHeal.updateMany).not.toHaveBeenCalled();
    });

    it('treats a run that never reached the step as a break in the sequence', async () => {
      mockPrisma.testRun.findMany.mockResolvedValue([
        corroboratedRun,
        { status: 'FAILED', steps: [] },
        corroboratedRun,
      ]);

      await service.evaluateCompletedRun('run-1');

      expect(mockPrisma.selectorHeal.updateMany).not.toHaveBeenCalled();
    });

    it('places a corroborated heal into the human review queue', async () => {
      mockPrisma.testRun.findMany.mockResolvedValue([corroboratedRun, corroboratedRun, corroboratedRun]);

      await service.evaluateCompletedRun('run-1');

      expect(mockPrisma.selectorHeal.updateMany).toHaveBeenCalledWith({
        where: { id: 'heal-1', eligibleForPromotion: false, promoted: false },
        data: { eligibleForPromotion: true },
      });
    });

    it('auto-promotes only high-confidence heals when the project opted in', async () => {
      mockPrisma.selectorHeal.findMany.mockResolvedValue([pendingHeal({
        runId: 'run-1',
        confidence: 'high',
        testDefinition: {
          project: { selectorHealAutoApply: true, selectorHealPromotionRuns: 3 },
        },
      })]);
      mockPrisma.testRun.findMany.mockResolvedValue([corroboratedRun, corroboratedRun, corroboratedRun]);
      const promote = jest.spyOn(service, 'promote').mockResolvedValue({} as never);

      await service.evaluateCompletedRun('run-1');

      expect(promote).toHaveBeenCalledWith('heal-1', undefined, { autoApplied: true });
    });

    it('does not evaluate preview, manual, or failed runs', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({
        status: 'PASSED', runMode: 'MANUAL', isPreview: false,
      });

      await service.evaluateCompletedRun('run-1');

      expect(mockPrisma.selectorHeal.findMany).not.toHaveBeenCalled();
    });
  });
});

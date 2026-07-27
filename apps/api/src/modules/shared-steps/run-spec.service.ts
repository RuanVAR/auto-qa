import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SharedStepResolverService } from './shared-step-resolver.service';

@Injectable()
export class RunSpecService {
  constructor(private readonly resolver: SharedStepResolverService) {}

  async build(test: { id: string; projectId: string; version: number; steps: unknown }): Promise<Prisma.InputJsonValue> {
    return await this.resolver.resolveForTest(test) as unknown as Prisma.InputJsonValue;
  }

  stepsFromSnapshot(executedSpec: unknown, fallback: unknown): Array<Record<string, unknown>> {
    const spec = executedSpec as { steps?: unknown } | null;
    return Array.isArray(spec?.steps) ? spec.steps as Array<Record<string, unknown>>
      : Array.isArray(fallback) ? fallback as Array<Record<string, unknown>>
      : [];
  }
}

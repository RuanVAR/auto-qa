import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isSharedStepReference, ResolvedRunSpec, SharedStepParameter } from './shared-step.types';

const MAX_SHARED_STEP_DEPTH = 5;
const TOKEN = /^\{\{[^}]+\}\}$/;

function cloneAndBind(value: unknown, bindings: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{([^}]+)\}\}/g, (whole, key) => bindings[key.trim()] ?? whole);
  }
  if (Array.isArray(value)) return value.map((item) => cloneAndBind(item, bindings));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, cloneAndBind(item, bindings)]));
  }
  return value;
}

@Injectable()
export class SharedStepResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForTest(test: { id: string; projectId: string; version: number; steps: unknown }): Promise<ResolvedRunSpec> {
    const project = await this.prisma.project.findUnique({ where: { id: test.projectId }, select: { orgId: true } });
    if (!project?.orgId) throw new BadRequestException('Shared steps require the project to belong to an organisation');
    const dependencies = new Map<string, { id: string; name: string; version: number }>();
    const resolveSteps = async (steps: unknown, ancestry: string[], depth: number): Promise<Array<Record<string, unknown>>> => {
      if (!Array.isArray(steps)) throw new BadRequestException('Shared step definitions must contain a steps array');
      const result: Array<Record<string, unknown>> = [];
      for (const sourceStep of steps) {
        if (!isSharedStepReference(sourceStep)) {
          result.push(sourceStep as Record<string, unknown>);
          continue;
        }
        if (depth >= MAX_SHARED_STEP_DEPTH) throw new BadRequestException(`Shared step nesting exceeds the maximum depth of ${MAX_SHARED_STEP_DEPTH}`);
        const id = sourceStep.input.sharedStepId;
        if (ancestry.includes(id)) throw new BadRequestException(`Shared step cycle detected: ${[...ancestry, id].join(' -> ')}`);
        const shared = await this.prisma.sharedStep.findUnique({ where: { id } });
        if (!shared) throw new NotFoundException(`Shared step ${id} was not found`);
        if (shared.orgId !== project.orgId || (shared.projectId !== null && shared.projectId !== test.projectId)) {
          throw new BadRequestException('A test may only reference shared steps from its project or organisation');
        }
        const parameters = Array.isArray(shared.parameters) ? shared.parameters as unknown as SharedStepParameter[] : [];
        const supplied = sourceStep.input.params ?? {};
        const bindings: Record<string, string> = {};
        for (const parameter of parameters) {
          const value = supplied[parameter.key] ?? parameter.defaultValue;
          if (parameter.required && !value) throw new BadRequestException(`Shared step "${shared.name}" requires parameter "${parameter.key}"`);
          if (value !== undefined) {
            if (parameter.secret && !TOKEN.test(value)) {
              throw new BadRequestException(`Secret parameter "${parameter.key}" must use an environment token or generator`);
            }
            bindings[parameter.key] = value;
          }
        }
        for (const key of Object.keys(supplied)) {
          if (!parameters.some((parameter) => parameter.key === key)) {
            throw new BadRequestException(`Shared step "${shared.name}" does not define parameter "${key}"`);
          }
        }
        dependencies.set(shared.id, { id: shared.id, name: shared.name, version: shared.version });
        const bound = cloneAndBind(shared.steps, bindings);
        result.push(...await resolveSteps(bound, [...ancestry, id], depth + 1));
      }
      return result;
    };

    return {
      schemaVersion: 1,
      testDefinitionId: test.id,
      testDefinitionVersion: test.version,
      steps: await resolveSteps(test.steps, [], 0),
      sharedStepDependencies: [...dependencies.values()],
    };
  }
}

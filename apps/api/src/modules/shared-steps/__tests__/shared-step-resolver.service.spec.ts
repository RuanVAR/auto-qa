import { BadRequestException } from '@nestjs/common';
import { SharedStepResolverService } from '../shared-step-resolver.service';

type Shared = {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  version: number;
  steps: unknown[];
  parameters: unknown[];
};

const test = { id: 'test-1', projectId: 'project-1', version: 4, steps: [] as unknown[] };

function resolverWith(sharedSteps: Shared[]) {
  const byId = new Map(sharedSteps.map((step) => [step.id, step]));
  return new SharedStepResolverService({
    project: { findUnique: jest.fn().mockResolvedValue({ orgId: 'org-1' }) },
    sharedStep: { findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(byId.get(where.id) ?? null)) },
  } as never);
}

describe('SharedStepResolverService', () => {
  it('flattens nested references and binds parameters into the immutable spec', async () => {
    const resolver = resolverWith([
      {
        id: 'child', orgId: 'org-1', projectId: 'project-1', name: 'Child', version: 2,
        parameters: [{ key: 'EMAIL', required: true }],
        steps: [{ type: 'FILL', input: { selector: '#email', value: '{{EMAIL}}' } }],
      },
      {
        id: 'parent', orgId: 'org-1', projectId: 'project-1', name: 'Parent', version: 3,
        parameters: [],
        steps: [{ type: 'SHARED', input: { sharedStepId: 'child', params: { EMAIL: 'person@example.test' } } }],
      },
    ]);

    const spec = await resolver.resolveForTest({ ...test, steps: [{ type: 'SHARED', input: { sharedStepId: 'parent' } }] });

    expect(spec.steps).toEqual([{ type: 'FILL', input: { selector: '#email', value: 'person@example.test' } }]);
    expect(spec.sharedStepDependencies).toEqual(expect.arrayContaining([
      { id: 'parent', name: 'Parent', version: 3 },
      { id: 'child', name: 'Child', version: 2 },
    ]));
  });

  it('rejects literal values supplied to secret parameters', async () => {
    const resolver = resolverWith([{
      id: 'secret', orgId: 'org-1', projectId: 'project-1', name: 'Secret', version: 1,
      parameters: [{ key: 'PASSWORD', required: true, secret: true }],
      steps: [{ type: 'FILL', input: { value: '{{PASSWORD}}' } }],
    }]);

    await expect(resolver.resolveForTest({ ...test, steps: [{ type: 'SHARED', input: { sharedStepId: 'secret', params: { PASSWORD: 'plain-text' } } }] }))
      .rejects.toThrow('must use an environment token or generator');
  });

  it('rejects cyclic shared-step references', async () => {
    const resolver = resolverWith([
      { id: 'a', orgId: 'org-1', projectId: 'project-1', name: 'A', version: 1, parameters: [], steps: [{ type: 'SHARED', input: { sharedStepId: 'b' } }] },
      { id: 'b', orgId: 'org-1', projectId: 'project-1', name: 'B', version: 1, parameters: [], steps: [{ type: 'SHARED', input: { sharedStepId: 'a' } }] },
    ]);

    await expect(resolver.resolveForTest({ ...test, steps: [{ type: 'SHARED', input: { sharedStepId: 'a' } }] }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(resolver.resolveForTest({ ...test, steps: [{ type: 'SHARED', input: { sharedStepId: 'a' } }] }))
      .rejects.toThrow('cycle detected');
  });
});

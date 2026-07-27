import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvironmentReleasesService } from './environment-releases.service';
import { GithubDeploymentsController } from './github-deployments.controller';

describe('GithubDeploymentsController', () => {
  const prisma = {
    projectRepo: { findFirst: jest.fn() },
    gitHubWebhookDelivery: {
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    environment: { findFirst: jest.fn() },
  };
  const releases = { recordDeployment: jest.fn() };
  let controller: GithubDeploymentsController;

  const repo = {
    id: 'repo-1',
    orgId: 'org-1',
    projectId: 'project-1',
    repoOwner: 'acme',
    repoName: 'service',
    webhookSecret: 'webhook-secret',
  };
  const body = {
    deployment: {
      id: 42,
      sha: 'abcdef',
      ref: 'main',
      environment: 'Staging',
      payload: {
        releaseVersion: '2026.07.25.4',
        componentName: 'API',
        componentVersion: '5.4.0',
      },
    },
    deployment_status: {
      id: 84,
      state: 'success',
      target_url: 'https://github.com/acme/service/actions/runs/84',
      created_at: '2026-07-25T10:00:00Z',
    },
    repository: { full_name: 'acme/service' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new GithubDeploymentsController(
      prisma as unknown as PrismaService,
      releases as unknown as EnvironmentReleasesService,
    );
    prisma.projectRepo.findFirst.mockResolvedValue(repo);
    prisma.gitHubWebhookDelivery.create.mockResolvedValue({ id: 'delivery-1' });
    prisma.gitHubWebhookDelivery.update.mockResolvedValue({ id: 'delivery-1' });
    prisma.gitHubWebhookDelivery.upsert.mockResolvedValue({ id: 'delivery-1' });
    prisma.environment.findFirst.mockResolvedValue({ id: 'env-1' });
    releases.recordDeployment.mockResolvedValue({ id: 'release-1' });
  });

  it('records a valid deployment status against the mapped environment', async () => {
    const rawBody = Buffer.from(JSON.stringify(body));

    const result = await controller.receive(
      repo.id,
      headers(rawBody, 'delivery-1'),
      { rawBody },
      body,
    );

    expect(result).toEqual({ ok: true, releaseId: 'release-1' });
    expect(releases.recordDeployment).toHaveBeenCalledWith(
      'project-1',
      'env-1',
      expect.objectContaining({
        releaseVersion: '2026.07.25.4',
        componentName: 'API',
        version: '5.4.0',
        commitSha: 'abcdef',
        branch: 'main',
      }),
      'GITHUB_DEPLOYMENT',
      'github:delivery-1',
    );
    expect(prisma.gitHubWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'RECORDED:release-1' }),
      }),
    );
  });

  it('rejects and audits an invalid signature without creating a release', async () => {
    const rawBody = Buffer.from(JSON.stringify(body));

    const result = await controller.receive(
      repo.id,
      {
        'x-github-delivery': 'delivery-invalid',
        'x-github-event': 'deployment_status',
        'x-hub-signature-256': 'sha256=invalid',
      },
      { rawBody },
      body,
    );

    expect(result).toEqual({ ok: false });
    expect(prisma.gitHubWebhookDelivery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deliveryId: 'delivery-invalid',
          signatureOk: false,
          outcome: 'INVALID_SIGNATURE',
        }),
      }),
    );
    expect(releases.recordDeployment).not.toHaveBeenCalled();
  });

  it('treats a repeated GitHub delivery id as an idempotent replay', async () => {
    const rawBody = Buffer.from(JSON.stringify(body));
    prisma.gitHubWebhookDelivery.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate delivery', {
        code: 'P2002',
        clientVersion: '5.9.1',
      }),
    );

    const result = await controller.receive(
      repo.id,
      headers(rawBody, 'delivery-repeat'),
      { rawBody },
      body,
    );

    expect(result).toEqual({ ok: true, duplicate: true });
    expect(releases.recordDeployment).not.toHaveBeenCalled();
  });

  function headers(rawBody: Buffer, deliveryId: string) {
    const signature = createHmac('sha256', repo.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return {
      'x-github-delivery': deliveryId,
      'x-github-event': 'deployment_status',
      'x-hub-signature-256': `sha256=${signature}`,
    };
  }
});

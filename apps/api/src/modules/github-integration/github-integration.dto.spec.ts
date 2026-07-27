import { GitAuthKind, RepoRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LinkRepoDto } from './dto/link-repo.dto';
import { UpdateRepoDto } from './dto/update-repo.dto';
import { UpsertGitCredentialDto } from './dto/upsert-git-credential.dto';
import { PutRepoEnvBindingsDto } from './dto/put-repo-env-bindings.dto';

describe('GitHub integration DTOs', () => {
  it('accepts a valid GitHub App credential payload', async () => {
    const dto = plainToInstance(UpsertGitCredentialDto, {
      authKind: GitAuthKind.APP,
      appId: '123',
      appInstallationId: '456',
      privateKey: 'private-key',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects non-numeric GitHub App identifiers', async () => {
    const dto = plainToInstance(UpsertGitCredentialDto, {
      authKind: GitAuthKind.APP,
      appId: 'app-id',
      appInstallationId: 'installation-id',
      privateKey: 'private-key',
    });

    await expect(validate(dto)).resolves.toHaveLength(2);
  });

  it('rejects unsafe repository owner and branch values', async () => {
    const dto = plainToInstance(LinkRepoDto, {
      repoOwner: '../other-org',
      repoName: 'repo',
      role: RepoRole.BACKEND,
      defaultBranch: '../secret',
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'defaultBranch',
      'repoOwner',
    ]);
  });

  it('rejects oversized include and exclude glob sets', async () => {
    const dto = plainToInstance(UpdateRepoDto, {
      includeGlobs: Array.from({ length: 51 }, (_, index) => `src/${index}/**`),
      excludeGlobs: Array.from({ length: 51 }, (_, index) => `dist/${index}/**`),
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'excludeGlobs',
      'includeGlobs',
    ]);
  });

  it('validates every environment branch binding', async () => {
    const dto = plainToInstance(PutRepoEnvBindingsDto, {
      bindings: [
        {
          environmentId: 'not-a-uuid',
          branch: '../secret',
        },
      ],
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('bindings');
    expect(errors[0].children?.[0].children?.map((error) => error.property).sort())
      .toEqual(['branch', 'environmentId']);
  });
});

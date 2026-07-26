import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDeploymentDto } from './create-deployment.dto';

describe('CreateDeploymentDto', () => {
  it('accepts a stack-neutral release with component metadata', async () => {
    const dto = plainToInstance(CreateDeploymentDto, {
      status: 'success',
      releaseVersion: '2026.07.26.4',
      commitSha: 'abcdef',
      branch: 'main',
      pipelineUrl: 'https://github.com/acme/app/actions/runs/42',
      components: [{
        name: 'API',
        version: '5.4.0',
        artifactDigest: 'sha256:abc',
      }],
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.status).toBe('SUCCESS');
  });

  it('rejects malformed pipeline URLs and oversized component lists', async () => {
    const dto = plainToInstance(CreateDeploymentDto, {
      status: 'SUCCESS',
      releaseVersion: '2026.07.26.4',
      pipelineUrl: 'not-a-url',
      components: Array.from({ length: 51 }, (_, index) => ({
        name: `component-${index}`,
        version: '1.0.0',
      })),
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['pipelineUrl', 'components']),
    );
  });
});

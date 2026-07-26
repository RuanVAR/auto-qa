import { Injectable } from '@nestjs/common';
import {
  VersionFileFormat,
  VersionSourceMode,
} from '@prisma/client';
import { ProjectReposService } from '../github-integration/project-repos.service';
import {
  AUTO_VERSION_MANIFESTS,
  extractVersion,
  inferVersionFileFormat,
  VersionManifestCandidate,
} from './version-extractor';

const MAX_MANIFEST_BYTES = 1024 * 1024;

export interface VersionBindingConfig {
  projectId: string;
  projectRepoId: string;
  versionSource: VersionSourceMode;
  versionFilePath: string | null;
  versionFileFormat: VersionFileFormat;
  versionSelector: string | null;
}

export interface ResolvedManifestVersion {
  version: string;
  manifestPath: string;
  manifestSha: string;
}

@Injectable()
export class VersionResolverService {
  constructor(private readonly repos: ProjectReposService) {}

  async resolve(
    binding: VersionBindingConfig,
    ref: string,
  ): Promise<ResolvedManifestVersion | null> {
    if (
      binding.versionSource === VersionSourceMode.CI_ONLY
      || binding.versionSource === VersionSourceMode.GIT_TAG
    ) {
      return null;
    }

    const candidates = binding.versionFilePath
      ? [configuredCandidate(binding)]
      : AUTO_VERSION_MANIFESTS;

    for (const candidate of candidates) {
      const resolved = await this.readCandidate(binding, ref, candidate);
      if (resolved) return resolved;
    }
    return null;
  }

  private async readCandidate(
    binding: VersionBindingConfig,
    ref: string,
    candidate: VersionManifestCandidate,
  ): Promise<ResolvedManifestVersion | null> {
    try {
      const file = await this.repos.readRepoFile(
        binding.projectId,
        binding.projectRepoId,
        candidate.path,
        ref,
      );
      if (file.size > MAX_MANIFEST_BYTES) return null;
      const format = candidate.format === VersionFileFormat.AUTO
        ? inferVersionFileFormat(candidate.path)
        : candidate.format;
      for (const selector of candidate.selectors.length > 0 ? candidate.selectors : [undefined]) {
        const version = extractVersion(file.content, format, selector);
        if (version) {
          return {
            version,
            manifestPath: file.path,
            manifestSha: file.sha,
          };
        }
      }
      return null;
    } catch {
      // AUTO discovery deliberately probes several conventional paths. A
      // missing or malformed candidate is not exceptional; continue safely.
      return null;
    }
  }
}

function configuredCandidate(binding: VersionBindingConfig): VersionManifestCandidate {
  const path = binding.versionFilePath!;
  return {
    path,
    format: binding.versionFileFormat === VersionFileFormat.AUTO
      ? inferVersionFileFormat(path)
      : binding.versionFileFormat,
    selectors: binding.versionSelector ? [binding.versionSelector] : [],
  };
}

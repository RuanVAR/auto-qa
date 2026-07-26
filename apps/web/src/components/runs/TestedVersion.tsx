import { GitCommit, Layers3 } from 'lucide-react';
import type {
  EnvironmentRelease,
  EnvironmentReleaseComponent,
  EnvironmentReleaseSource,
} from '@/lib/api';
import { cn } from '@/lib/utils';

export type TestedRelease = Pick<
  EnvironmentRelease,
  'id' | 'version' | 'source' | 'deployedAt'
> & {
  commitSha?: string | null;
  branch?: string | null;
  pipelineUrl?: string | null;
  components?: Array<Partial<EnvironmentReleaseComponent> & {
    id: string;
    componentName: string;
    version: string | null;
  }>;
};

export function TestedVersion({
  release,
  className,
  emptyLabel = 'Not captured',
  tone = 'light',
}: {
  release?: TestedRelease | null;
  className?: string;
  emptyLabel?: string;
  tone?: 'light' | 'dark';
}) {
  if (!release) {
    return (
      <span
        className={cn(
          'text-xs',
          tone === 'dark' ? 'text-slate-500' : 'text-gray-400',
          className,
        )}
      >
        {emptyLabel}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap font-mono text-xs font-semibold',
        tone === 'dark' ? 'text-sky-300' : 'text-sky-700',
        className,
      )}
      title={`Tested version ${release.version} · ${releaseSourceLabel(release.source)}`}
    >
      <GitCommit size={12} className="shrink-0" />
      <span className="max-w-40 truncate">{release.version}</span>
    </span>
  );
}

export function TestedVersions({
  releases,
  tone = 'light',
}: {
  releases?: TestedRelease[] | null;
  tone?: 'light' | 'dark';
}) {
  if (!releases?.length) {
    return <TestedVersion release={null} tone={tone} />;
  }
  if (releases.length === 1) {
    return <TestedVersion release={releases[0]} tone={tone} />;
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium',
        tone === 'dark' ? 'text-sky-300' : 'text-sky-700',
      )}
      title={releases.map((release) => release.version).join(', ')}
    >
      <Layers3 size={12} />
      {releases.length} versions
    </span>
  );
}

export function TestedVersionPanel({
  release,
  environmentName,
}: {
  release?: TestedRelease | null;
  environmentName?: string | null;
}) {
  return (
    <section className="border-y border-gray-200 bg-gray-50/70 px-4 py-3 dark:border-white/10 dark:bg-white/[0.025]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase text-gray-400 dark:text-slate-500">
            Tested version
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <TestedVersion release={release} tone="dark" />
            {environmentName && (
              <span className="text-xs text-gray-500 dark:text-slate-400">
                {environmentName}
              </span>
            )}
          </div>
        </div>
        {release && (
          <div className="text-right text-xs text-gray-400 dark:text-slate-500">
            <div>{releaseSourceLabel(release.source)}</div>
            {release.commitSha && (
              <div className="mt-0.5 font-mono">{release.commitSha.slice(0, 12)}</div>
            )}
          </div>
        )}
      </div>

      {!!release?.components?.length && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {release.components.map((component) => (
            <div
              key={component.id}
              className="min-w-0 border-l-2 border-sky-400 pl-2"
            >
              <div className="truncate text-xs font-medium text-gray-700 dark:text-slate-200">
                {component.componentName}
              </div>
              <div className="truncate font-mono text-xs text-gray-500 dark:text-slate-400">
                {component.version ?? 'Version not supplied'}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function releaseSourceLabel(source: EnvironmentReleaseSource): string {
  const labels: Record<EnvironmentReleaseSource, string> = {
    CI_API: 'CI verified',
    GITHUB_DEPLOYMENT: 'GitHub deployment',
    REPO_INFERRED: 'Repository inferred',
    MANUAL: 'Manual',
  };
  return labels[source];
}

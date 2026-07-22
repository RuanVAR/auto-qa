import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Resolves the cascading binding config for a dispatch scope.
 *
 * Walks feature → module → project → install (most specific first) and merges
 * each layer's `bindingConfig`. Caller supplies the install + an optional
 * scope hint (the createIssue / linkTicket payload's `scope` field carries
 * featureId / moduleId / issueId, which gives us the chain to walk).
 *
 * Returns a plain object suitable to pass as `effectiveConfig` to
 * PluginService.dispatch — keys at narrower scopes win, identical to the
 * effective-config util used elsewhere.
 *
 * Why a service: dispatch endpoints, push-feature endpoint, and the routing
 * hint all need the same walk. Centralising avoids three drifted copies.
 */
@Injectable()
export class ScopeResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the effective binding config for a single install + scope.
   *
   * @param installId - the OrgPluginInstall to resolve against
   * @param scope - one of feature/module/project/issue/finding/defect (issue
   *                and defect inherit from the parent project; finding has no
   *                module/feature link today)
   */
  async resolve(
    installId: string,
    scope?: {
      featureId?: string;
      moduleId?: string;
      projectId?: string;
      issueId?: string;
      defectId?: string;
    } | null,
  ): Promise<Record<string, unknown>> {
    const ids = await this.expandScope(scope);
    const layers: Array<Record<string, unknown> | null | undefined> = [];

    if (ids.featureId) {
      const f = await this.prisma.featurePluginBinding.findFirst({
        where: { featureId: ids.featureId, installId, deletedAt: null },
      });
      if (f) layers.push(f.bindingConfig as Record<string, unknown>);
    }
    if (ids.moduleId) {
      const m = await this.prisma.modulePluginBinding.findFirst({
        where: { moduleId: ids.moduleId, installId, deletedAt: null },
      });
      if (m) layers.push(m.bindingConfig as Record<string, unknown>);
    }
    if (ids.projectId) {
      const p = await this.prisma.projectPluginBinding.findFirst({
        where: { projectId: ids.projectId, installId, deletedAt: null },
      });
      if (p) layers.push(p.bindingConfig as Record<string, unknown>);
    }
    const install = await this.prisma.orgPluginInstall.findUnique({ where: { id: installId } });
    if (install?.config) layers.push(install.config as Record<string, unknown>);

    // Merge: most specific first means later writes shouldn't overwrite earlier ones.
    const out: Record<string, unknown> = {};
    for (const layer of layers) {
      if (!layer) continue;
      for (const [k, v] of Object.entries(layer)) {
        if (out[k] === undefined && v !== undefined && v !== null && v !== '') out[k] = v;
      }
    }
    return out;
  }

  /**
   * Walks scope-id forward references — given a featureId, derive its
   * moduleId and projectId; given a moduleId, derive its projectId; given
   * an issueId, derive featureId/moduleId/projectId from the issue row.
   */
  private async expandScope(scope?: {
    featureId?: string;
    moduleId?: string;
    projectId?: string;
    issueId?: string;
    defectId?: string;
  } | null): Promise<{ featureId?: string; moduleId?: string; projectId?: string }> {
    if (!scope) return {};
    let { featureId, moduleId, projectId } = scope;

    if (scope.issueId && !featureId && !moduleId && !projectId) {
      const issue = await this.prisma.issue.findUnique({
        where: { id: scope.issueId },
        select: { featureId: true, moduleId: true, projectId: true },
      });
      if (issue) {
        featureId = issue.featureId ?? undefined;
        moduleId = issue.moduleId ?? undefined;
        projectId = issue.projectId;
      }
    }
    if (scope.defectId && !projectId) {
      const defect = await this.prisma.defect.findUnique({
        where: { id: scope.defectId },
        select: { projectId: true },
      });
      projectId = defect?.projectId ?? projectId;
    }
    if (featureId && (!moduleId || !projectId)) {
      const f = await this.prisma.feature.findUnique({
        where: { id: featureId },
        select: { moduleId: true, module: { select: { projectId: true } } },
      });
      if (f) {
        moduleId = moduleId ?? f.moduleId;
        projectId = projectId ?? f.module.projectId;
      }
    }
    if (moduleId && !projectId) {
      const m = await this.prisma.module.findUnique({ where: { id: moduleId }, select: { projectId: true } });
      if (m) projectId = m.projectId;
    }
    return { featureId, moduleId, projectId };
  }
}

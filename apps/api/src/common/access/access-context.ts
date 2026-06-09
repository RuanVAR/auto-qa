/**
 * The context object every EnvAccessService method takes
 * (`assertProjectAccess`, `assertEnvAccess`, `assertElevatedProjectAccess`, …).
 *
 * Previously each of ~30 call sites hand-built this literal inline:
 *   `{ jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole }, orgId: user.activeOrgId }`
 * A few sites OMITTED `orgId`, which made the ORG_ADMIN bypass match any org
 * (the access service falls back to the project's own orgId when `orgId` is
 * undefined → an admin of org A could bypass on org B's project). Routing every
 * site through this helper passes `activeOrgId` consistently and closes that gap.
 */
export interface AccessContextUser {
  orgRole?: string | null;
  platformRole?: string | null;
  activeOrgId?: string | null;
}

export interface AccessContext {
  jwtRoleHint: { orgRole?: string | null; platformRole?: string | null };
  orgId?: string | null;
}

export function accessCtx(user: AccessContextUser): AccessContext {
  return {
    jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
    orgId: user.activeOrgId ?? null,
  };
}

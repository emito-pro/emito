import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";

export type WorkspaceRole = "admin" | "member" | null;

export type ResolveWorkspaceRole = (
	subscriberId: string,
	workspaceId: string,
) => Promise<WorkspaceRole>;

export async function enforceWorkspaceRole(
	resolveWorkspaceRole: ResolveWorkspaceRole,
	subscriberId: string,
	workspaceId: string,
	method: string,
): Promise<WorkspaceRole> {
	const role = await resolveWorkspaceRole(subscriberId, workspaceId);

	if (role === null) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE,
			message: "Not a member of this workspace",
		});
	}

	// Write operations (POST, PUT, PATCH) on workspace paths require admin role
	const isWrite = method === "POST" || method === "PUT" || method === "PATCH";
	if (isWrite && role !== "admin") {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE,
			message: "Workspace admin role required for write operations",
		});
	}

	return role;
}

export async function requireMembership(
	resolveWorkspaceRole: ResolveWorkspaceRole,
	subscriberId: string,
	workspaceId: string,
): Promise<WorkspaceRole> {
	const role = await resolveWorkspaceRole(subscriberId, workspaceId);

	if (role === null) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE,
			message: "Not a member of this workspace",
		});
	}

	return role;
}

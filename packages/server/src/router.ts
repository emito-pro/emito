import type { z } from "zod";

/**
 * The version segment carried by every public HTTP route of `@emito/server`.
 *
 * Bump this only for a breaking change to the wire contract — a removed field,
 * a changed type, a moved path. Additive changes stay on the current version.
 */
export const API_VERSION = "v1";

export type AuthScope = "public" | "subscriber" | "workspace" | "admin";

export interface RouteSchema {
	params?: z.ZodType;
	query?: z.ZodType;
	body?: z.ZodType;
}

// --- Typed RouteContext ---

type BaseContext<P, Q, B> = {
	params: P extends z.ZodType ? z.infer<P> : Record<string, string>;
	query: Q extends z.ZodType ? z.infer<Q> : Record<string, string | string[]>;
	body: B extends z.ZodType ? z.infer<B> : unknown;
	rawBody?: string;
};

type SubscriberFields = { subscriberId: string };
type WorkspaceFields = { subscriberId: string; workspaceRole: "admin" | "member" | null };

export type RouteContextFor<
	Auth extends AuthScope = "public",
	P = undefined,
	Q = undefined,
	B = undefined,
> = BaseContext<P, Q, B> &
	(Auth extends "subscriber" | "workspace"
		? Auth extends "workspace"
			? WorkspaceFields
			: SubscriberFields
		: // biome-ignore lint/complexity/noBannedTypes: empty intersection — public routes add no auth fields
			{});

/** Backward-compatible alias — equivalent to `RouteContextFor<"public">` */
export type RouteContext = RouteContextFor<"public">;

/** Internal runtime context with all optional auth fields — used only in handler.ts ctx construction */
export type RuntimeRouteContext = {
	params: Record<string, string> | unknown;
	query: Record<string, string | string[]> | unknown;
	body: unknown;
	rawBody?: string;
	subscriberId?: string;
	workspaceRole?: "admin" | "member" | null;
};

export type RouteHandler<
	A extends AuthScope = AuthScope,
	P = undefined,
	Q = undefined,
	B = undefined,
> = (ctx: RouteContextFor<A, P, Q, B>, request: Request) => Promise<Response>;

// --- Route definitions ---

export interface RouteDefinition {
	method: string;
	pathPattern: string;
	handler: RouteHandler<
		AuthScope,
		z.ZodType | undefined,
		z.ZodType | undefined,
		z.ZodType | undefined
	>;
	auth: AuthScope;
	schema?: RouteSchema;
	/** Mounted directly under the prefix, skipping the API version segment. */
	unversioned?: boolean;
}

export interface RouteMatch {
	route: RouteDefinition;
	params: Record<string, string>;
}

// --- Router ---

export interface RouteConfig<
	A extends AuthScope,
	P extends z.ZodType | undefined,
	Q extends z.ZodType | undefined,
	B extends z.ZodType | undefined,
> {
	method: string;
	pathPattern: string;
	auth: A;
	schema?: { params?: P; query?: Q; body?: B };
	handler: RouteHandler<A, P, Q, B>;
	/**
	 * Mount this route directly under the prefix, skipping the version segment.
	 *
	 * Reserved for paths that outlive an API version: operational probes, links
	 * baked into already-delivered email, and URLs configured in a third party's
	 * console. Versioning those would pin the old version open forever.
	 */
	unversioned?: boolean;
}

/**
 * Build the router.
 *
 * `prefix` is the mount path only (e.g. `/emito`) — it says where the host
 * application attaches the handler. `version`, when given, is inserted after it
 * so every route carries the API version regardless of how the host mounts the
 * server. Omit `version` for routers whose consumer ships in lockstep with the
 * server, where a version segment buys nothing.
 */
export function createRouter(prefix: string, version?: string) {
	const routes: RouteDefinition[] = [];
	const versionedPrefix = version ? `${prefix}/${version}` : prefix;

	function add<
		A extends AuthScope,
		P extends z.ZodType | undefined = undefined,
		Q extends z.ZodType | undefined = undefined,
		B extends z.ZodType | undefined = undefined,
	>(route: RouteConfig<A, P, Q, B>): void {
		routes.push({
			...route,
			handler: route.handler as RouteDefinition["handler"],
			pathPattern: (route.unversioned ? prefix : versionedPrefix) + route.pathPattern,
		});
	}

	function match(method: string, pathname: string): RouteMatch | null {
		for (const route of routes) {
			if (route.method !== method && route.method !== "*") continue;
			const params = matchPath(route.pathPattern, pathname);
			if (params !== null) return { route, params };
		}
		return null;
	}

	return { add, match, routes };
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
	const patternParts = pattern.split("/").filter(Boolean);
	const pathParts = pathname.split("/").filter(Boolean);
	if (patternParts.length !== pathParts.length) return null;

	const params: Record<string, string> = {};
	for (let i = 0; i < patternParts.length; i++) {
		// biome-ignore lint/style/noNonNullAssertion: bounds guaranteed by loop condition + length check above
		const pat = patternParts[i]!;
		// biome-ignore lint/style/noNonNullAssertion: bounds guaranteed by loop condition + length check above
		const val = pathParts[i]!;
		if (pat.startsWith(":")) {
			params[pat.slice(1)] = decodeURIComponent(val);
		} else if (pat !== val) {
			return null;
		}
	}
	return params;
}

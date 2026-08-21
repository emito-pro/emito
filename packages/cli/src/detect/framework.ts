export interface PackageJsonDeps {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

export type BackendFramework = "express" | "fastify" | "hono" | "nextjs" | "node";
export type FrontendFramework = "react-vite" | "react-next" | "react" | "none";

function hasDep(pkg: PackageJsonDeps, name: string): boolean {
	return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

export function detectBackendFramework(pkg: PackageJsonDeps): BackendFramework | null {
	const matches: BackendFramework[] = [];
	if (hasDep(pkg, "fastify")) matches.push("fastify");
	if (hasDep(pkg, "hono")) matches.push("hono");
	if (hasDep(pkg, "next")) matches.push("nextjs");
	if (hasDep(pkg, "express")) matches.push("express");
	return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function detectFrontendFramework(pkg: PackageJsonDeps): FrontendFramework {
	if (!hasDep(pkg, "react")) return "none";
	if (hasDep(pkg, "next")) return "react-next";
	if (hasDep(pkg, "vite")) return "react-vite";
	return "react";
}

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		DB_URI: string;
	}
}

export default async function setup(project: TestProject) {
	try {
		const container = await new PostgreSqlContainer("postgres:16-alpine")
			.withDatabase("emito_test")
			.start();

		project.provide("DB_URI", container.getConnectionUri());

		return async function teardown() {
			await container.stop();
		};
	} catch {
		// Docker not available — provide empty string, integration tests will skip
		project.provide("DB_URI", "");
	}
}

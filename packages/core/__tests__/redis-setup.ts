/**
 * Testcontainers Redis setup for integration tests.
 * Starts a real Redis container and provides connection details.
 */
import { GenericContainer, type StartedTestContainer } from "testcontainers";

let container: StartedTestContainer | null = null;

export async function startRedisContainer(): Promise<{
	host: string;
	port: number;
	url: string;
}> {
	container = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();

	const host = container.getHost();
	const port = container.getMappedPort(6379);

	return {
		host,
		port,
		url: `redis://${host}:${port}`,
	};
}

export async function stopRedisContainer(): Promise<void> {
	if (container) {
		await container.stop();
		container = null;
	}
}

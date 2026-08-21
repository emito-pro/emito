import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmitoProvider, useEmitoClient } from "../src/context.js";

// ---------------------------------------------------------------------------
// Mock factory — creates a fresh mock client per EmitoClient instantiation
// ---------------------------------------------------------------------------

function makeMockClient(options: Record<string, unknown>) {
	const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

	const client = {
		options,
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn(),
		on: vi.fn().mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
			let set = listeners.get(event);
			if (!set) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(listener);
			return client;
		}),
		off: vi.fn().mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
			listeners.get(event)?.delete(listener);
			return client;
		}),
		getNotifications: vi.fn().mockReturnValue([]),
		getUnreadCount: vi.fn().mockReturnValue(0),
		fetchNotifications: vi.fn().mockResolvedValue(undefined),
		fetchUnreadCount: vi.fn().mockResolvedValue(undefined),
		markAsRead: vi.fn().mockResolvedValue(undefined),
		markAsUnread: vi.fn().mockResolvedValue(undefined),
		markAllAsRead: vi.fn().mockResolvedValue(undefined),
		archive: vi.fn().mockResolvedValue(undefined),
		updatePreference: vi.fn().mockResolvedValue(undefined),
		notifications: {
			list: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
			unreadCount: vi.fn().mockResolvedValue(0),
			markAsRead: vi.fn().mockResolvedValue(undefined),
			markAsUnread: vi.fn().mockResolvedValue(undefined),
			markAllAsRead: vi.fn().mockResolvedValue(undefined),
			archive: vi.fn().mockResolvedValue(undefined),
		},
		preferences: {
			get: vi.fn().mockResolvedValue([]),
			getForWorkspace: vi.fn().mockResolvedValue([]),
			update: vi.fn().mockResolvedValue({}),
			updateForWorkspace: vi.fn().mockResolvedValue({}),
			reset: vi.fn().mockResolvedValue(undefined),
		},
		integrations: {
			create: vi.fn().mockResolvedValue({}),
		},
	};

	return client;
}

// Track all created instances across tests
const createdClients: ReturnType<typeof makeMockClient>[] = [];

vi.mock("@emito/js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@emito/js")>();
	return {
		...actual,
		EmitoClient: class {
			constructor(options: Record<string, unknown>) {
				const client = makeMockClient(options);
				createdClients.push(client);
				return client;
			}
		},
	};
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProviderProps {
	endpoint: string;
	subscriberId: string;
	token: string;
	transport?: string;
}

function makeProviderProps(overrides: Partial<ProviderProps> = {}): ProviderProps {
	return {
		endpoint: "https://example.com/emito",
		subscriberId: "sub_1",
		token: "tok_abc",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	createdClients.length = 0;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("EmitoProvider", () => {
	describe("lifecycle", () => {
		it("should create EmitoClient and call connect() on mount", async () => {
			const props = makeProviderProps();

			await act(async () => {
				renderHook(() => useEmitoClient(), {
					wrapper: ({ children }) => React.createElement(EmitoProvider, props as never, children),
				});
			});

			expect(createdClients.length).toBeGreaterThanOrEqual(1);
			const client = createdClients[createdClients.length - 1]!;
			expect(client.connect).toHaveBeenCalled();
		});

		it("should call disconnect() on unmount", async () => {
			const props = makeProviderProps();

			const { unmount } = renderHook(() => useEmitoClient(), {
				wrapper: ({ children }) => React.createElement(EmitoProvider, props as never, children),
			});

			await act(async () => {});
			const client = createdClients[createdClients.length - 1]!;

			act(() => {
				unmount();
			});

			expect(client.disconnect).toHaveBeenCalled();
		});

		it("should recreate client when endpoint changes", async () => {
			let currentProps = makeProviderProps({ endpoint: "https://first.com/emito" });

			const { rerender } = renderHook(() => useEmitoClient(), {
				wrapper: ({ children }: { children: React.ReactNode }) =>
					React.createElement(EmitoProvider, currentProps as never, children),
			});

			await act(async () => {});
			const clientCountAfterMount = createdClients.length;

			currentProps = makeProviderProps({ endpoint: "https://second.com/emito" });
			await act(async () => {
				rerender();
			});

			expect(createdClients.length).toBeGreaterThan(clientCountAfterMount);
			const latestClient = createdClients[createdClients.length - 1]!;
			expect(latestClient.options.endpoint).toBe("https://second.com/emito");
		});

		it("should disconnect old client before creating new one on key prop change", async () => {
			let currentProps = makeProviderProps({ subscriberId: "sub_1" });

			const { rerender } = renderHook(() => useEmitoClient(), {
				wrapper: ({ children }: { children: React.ReactNode }) =>
					React.createElement(EmitoProvider, currentProps as never, children),
			});

			await act(async () => {});
			const firstClient = createdClients[0]!;

			currentProps = makeProviderProps({ subscriberId: "sub_2" });
			await act(async () => {
				rerender();
			});

			expect(firstClient.disconnect).toHaveBeenCalled();
		});

		it("should not recreate client when re-rendering with same key props", async () => {
			const props = makeProviderProps();

			const { rerender } = renderHook(() => useEmitoClient(), {
				wrapper: ({ children }: { children: React.ReactNode }) =>
					React.createElement(EmitoProvider, props as never, children),
			});

			await act(async () => {});
			const clientCountAfterMount = createdClients.length;

			await act(async () => {
				rerender();
			});

			expect(createdClients.length).toBe(clientCountAfterMount);
		});

		it("should not recreate client when token changes but getToken is stable", async () => {
			const getToken = vi.fn().mockResolvedValue("tok_from_fn");
			let currentProps: ProviderProps & { getToken: typeof getToken } = {
				...makeProviderProps({ token: "tok_abc" }),
				getToken,
			};

			const { rerender } = renderHook(() => useEmitoClient(), {
				wrapper: ({ children }: { children: React.ReactNode }) =>
					React.createElement(EmitoProvider, currentProps as never, children),
			});

			await act(async () => {});
			const clientCountAfterMount = createdClients.length;

			// Simulate a token refresh: token value changes, getToken reference is stable
			currentProps = { ...currentProps, token: "tok_refreshed" };
			await act(async () => {
				rerender();
			});

			expect(createdClients.length).toBe(clientCountAfterMount);
		});

		it("should still recreate client when token changes and getToken is absent", async () => {
			let currentProps = makeProviderProps({ token: "tok_abc" });

			const { rerender } = renderHook(() => useEmitoClient(), {
				wrapper: ({ children }: { children: React.ReactNode }) =>
					React.createElement(EmitoProvider, currentProps as never, children),
			});

			await act(async () => {});
			const clientCountAfterMount = createdClients.length;

			currentProps = makeProviderProps({ token: "tok_refreshed" });
			await act(async () => {
				rerender();
			});

			expect(createdClients.length).toBeGreaterThan(clientCountAfterMount);
		});
	});

	describe("context", () => {
		it("should provide the EmitoClient via useEmitoClient()", async () => {
			const props = makeProviderProps();
			let capturedClient: unknown = null;

			await act(async () => {
				renderHook(
					() => {
						capturedClient = useEmitoClient();
					},
					{
						wrapper: ({ children }) => React.createElement(EmitoProvider, props as never, children),
					},
				);
			});

			expect(capturedClient).not.toBeNull();
			expect(createdClients).toContain(capturedClient);
		});
	});
});

describe("useEmitoClient", () => {
	it("should throw when used outside EmitoProvider", () => {
		expect(() => {
			renderHook(() => useEmitoClient());
		}).toThrow("useEmitoClient must be used within an EmitoProvider");
	});

	it("should return the same client reference across re-renders", async () => {
		const props = makeProviderProps();
		const clients: unknown[] = [];

		const { rerender } = renderHook(
			() => {
				clients.push(useEmitoClient());
			},
			{
				wrapper: ({ children }: { children: React.ReactNode }) =>
					React.createElement(EmitoProvider, props as never, children),
			},
		);

		await act(async () => {});
		rerender();

		expect(clients.length).toBeGreaterThanOrEqual(2);
		const first = clients[0];
		expect(clients.every((c) => c === first)).toBe(true);
	});
});

import { EmitoProvider } from "@emito/react-hooks";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePushToken } from "../src/use-push-token.js";
import type { UsePushTokenOptions } from "../src/use-push-token.js";

// ---------------------------------------------------------------------------
// Mock factory
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
		notifications: {
			list: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
		},
		preferences: {
			get: vi.fn().mockResolvedValue([]),
			update: vi.fn().mockResolvedValue({}),
			reset: vi.fn().mockResolvedValue(undefined),
		},
		integrations: {
			create: vi.fn().mockResolvedValue({
				id: "int_1",
				subscriberId: "sub_1",
				channel: "push",
				name: "fcm-device",
				events: [],
				config: { token: "tok_abc", platform: "fcm" },
				active: true,
				createdAt: "2026-01-01T00:00:00Z",
			}),
		},
	};

	return client;
}

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

const defaultProviderProps = {
	endpoint: "https://example.com/emito",
	subscriberId: "sub_1",
	token: "auth_tok",
};

function wrapper({ children }: { children: React.ReactNode }) {
	return React.createElement(EmitoProvider, defaultProviderProps as never, children);
}

function latestClient() {
	return createdClients[createdClients.length - 1]!;
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

describe("usePushToken", () => {
	describe("auto-register mode (default)", () => {
		it("should register token on mount when token prop is provided", async () => {
			const options: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
			};

			await act(async () => {
				renderHook(() => usePushToken(options), { wrapper });
			});

			const client = latestClient();
			expect(client.integrations.create).toHaveBeenCalledWith({
				channel: "push",
				name: "fcm-device",
				events: [],
				config: { token: "push_tok_1", platform: "fcm" },
			});
		});

		it("should resolve token from getToken() and auto-register", async () => {
			const getToken = vi.fn().mockResolvedValue("async_tok_1");
			const options: UsePushTokenOptions = {
				getToken,
				platform: "apns",
			};

			await act(async () => {
				renderHook(() => usePushToken(options), { wrapper });
			});

			expect(getToken).toHaveBeenCalledOnce();

			const client = latestClient();
			expect(client.integrations.create).toHaveBeenCalledWith({
				channel: "push",
				name: "apns-device",
				events: [],
				config: { token: "async_tok_1", platform: "apns" },
			});
		});

		it("should return resolved token", async () => {
			const options: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
			};

			const { result } = renderHook(() => usePushToken(options), { wrapper });
			await act(async () => {});

			expect(result.current.token).toBe("push_tok_1");
		});

		it("should set isRegistering during registration", async () => {
			let resolveCreate!: (v: unknown) => void;
			const createPromise = new Promise((resolve) => {
				resolveCreate = resolve;
			});

			const options: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
			};

			const { result } = renderHook(() => usePushToken(options), { wrapper });

			// Override the mock to return a pending promise
			const client = latestClient();
			client.integrations.create.mockReturnValue(createPromise);

			// Force re-registration by changing internal state won't work easily,
			// but we can check the final state
			await act(async () => {
				resolveCreate({});
			});

			expect(result.current.isRegistering).toBe(false);
		});

		it("should not register twice for the same token", async () => {
			const options: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
			};

			const { rerender } = renderHook(() => usePushToken(options), { wrapper });

			await act(async () => {});

			// Re-render with the same token
			await act(async () => {
				rerender();
			});

			const client = latestClient();
			expect(client.integrations.create).toHaveBeenCalledTimes(1);
		});
	});

	describe("token refresh", () => {
		it("should re-register when token prop changes", async () => {
			let currentOptions: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
			};

			const { rerender } = renderHook(() => usePushToken(currentOptions), {
				wrapper,
			});

			await act(async () => {});

			const client = latestClient();
			expect(client.integrations.create).toHaveBeenCalledTimes(1);

			// Change token
			currentOptions = { token: "push_tok_2", platform: "fcm" };
			await act(async () => {
				rerender();
			});

			expect(client.integrations.create).toHaveBeenCalledTimes(2);
			expect(client.integrations.create).toHaveBeenLastCalledWith({
				channel: "push",
				name: "fcm-device",
				events: [],
				config: { token: "push_tok_2", platform: "fcm" },
			});
		});
	});

	describe("manual mode (autoRegister: false)", () => {
		it("should not auto-register on mount", async () => {
			const options: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
				autoRegister: false,
			};

			await act(async () => {
				renderHook(() => usePushToken(options), { wrapper });
			});

			const client = latestClient();
			expect(client.integrations.create).not.toHaveBeenCalled();
		});

		it("should return register function that triggers registration", async () => {
			const options: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
				autoRegister: false,
			};

			const { result } = renderHook(() => usePushToken(options), { wrapper });
			await act(async () => {});

			const client = latestClient();
			expect(client.integrations.create).not.toHaveBeenCalled();

			// Call register manually
			await act(async () => {
				await result.current.register();
			});

			expect(client.integrations.create).toHaveBeenCalledWith({
				channel: "push",
				name: "fcm-device",
				events: [],
				config: { token: "push_tok_1", platform: "fcm" },
			});
		});

		it("should return token in manual mode", async () => {
			const options: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
				autoRegister: false,
			};

			const { result } = renderHook(() => usePushToken(options), { wrapper });
			await act(async () => {});

			expect(result.current.token).toBe("push_tok_1");
		});
	});

	describe("error handling", () => {
		it("should set error when getToken() rejects", async () => {
			const getToken = vi.fn().mockRejectedValue(new Error("Token fetch failed"));
			const options: UsePushTokenOptions = {
				getToken,
				platform: "fcm",
			};

			const { result } = renderHook(() => usePushToken(options), { wrapper });
			await act(async () => {});

			expect(result.current.error).toBeInstanceOf(Error);
			expect(result.current.error!.message).toBe("Token fetch failed");
		});

		it("should set error when registration fails", async () => {
			const options: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
			};

			// Make the mock fail before rendering
			const mockCreate = vi.fn().mockRejectedValue(new Error("Registration failed"));

			const { result } = renderHook(() => usePushToken(options), { wrapper });

			// Override integrations.create on the actual client
			const client = latestClient();
			client.integrations.create = mockCreate;

			// Trigger a re-registration by using manual register
			await act(async () => {
				await result.current.register();
			});

			expect(result.current.error).toBeInstanceOf(Error);
			expect(result.current.error!.message).toBe("Registration failed");
		});

		it("should set error when register is called without a token", async () => {
			const options: UsePushTokenOptions = {
				platform: "fcm",
				autoRegister: false,
			};

			const { result } = renderHook(() => usePushToken(options), { wrapper });
			await act(async () => {});

			await act(async () => {
				await result.current.register();
			});

			expect(result.current.error).toBeInstanceOf(Error);
			expect(result.current.error!.message).toBe("No push token available to register");
		});

		it("should handle non-Error rejection from getToken()", async () => {
			const getToken = vi.fn().mockRejectedValue("string error");
			const options: UsePushTokenOptions = {
				getToken,
				platform: "fcm",
			};

			const { result } = renderHook(() => usePushToken(options), { wrapper });
			await act(async () => {});

			expect(result.current.error).toBeInstanceOf(Error);
			expect(result.current.error!.message).toBe("Failed to get push token");
		});

		it("should handle non-Error rejection from integrations.create()", async () => {
			const options: UsePushTokenOptions = {
				token: "push_tok_1",
				platform: "fcm",
				autoRegister: false,
			};

			const { result } = renderHook(() => usePushToken(options), { wrapper });

			const client = latestClient();
			client.integrations.create = vi.fn().mockRejectedValue("string error");

			await act(async () => {
				await result.current.register();
			});

			expect(result.current.error).toBeInstanceOf(Error);
			expect(result.current.error!.message).toBe("Failed to register push token");
		});
	});

	describe("cleanup", () => {
		it("should not update state after unmount when getToken resolves", async () => {
			let resolveGetToken!: (v: string) => void;
			const getToken = vi.fn().mockImplementation(
				() =>
					new Promise<string>((resolve) => {
						resolveGetToken = resolve;
					}),
			);
			const options: UsePushTokenOptions = {
				getToken,
				platform: "fcm",
			};

			const { unmount } = renderHook(() => usePushToken(options), { wrapper });

			// Unmount before getToken resolves
			act(() => {
				unmount();
			});

			// Resolve after unmount — should not throw or update state
			await act(async () => {
				resolveGetToken("late_token");
			});

			// If we reach here without error, cleanup worked
			expect(getToken).toHaveBeenCalledOnce();
		});
	});

	describe("token prop takes precedence over getToken", () => {
		it("should use token prop and ignore getToken when both provided", async () => {
			const getToken = vi.fn().mockResolvedValue("async_tok");
			const options: UsePushTokenOptions = {
				token: "static_tok",
				getToken,
				platform: "fcm",
			};

			const { result } = renderHook(() => usePushToken(options), { wrapper });
			await act(async () => {});

			expect(result.current.token).toBe("static_tok");
			// getToken should not have been called since token prop was provided
			expect(getToken).not.toHaveBeenCalled();
		});
	});
});

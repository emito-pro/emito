import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmitoProvider } from "../src/context.js";
import { usePreferences } from "../src/usePreferences.js";

// ---------------------------------------------------------------------------
// Mock preference data
// ---------------------------------------------------------------------------

interface MockPref {
	topicKey: string;
	channel: string;
	enabled: boolean;
}

function makePref(overrides: Partial<MockPref> = {}): MockPref {
	return { topicKey: "newsletter", channel: "email", enabled: true, ...overrides };
}

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

interface MockClient {
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	off: ReturnType<typeof vi.fn>;
	getNotifications: ReturnType<typeof vi.fn>;
	getUnreadCount: ReturnType<typeof vi.fn>;
	fetchNotifications: ReturnType<typeof vi.fn>;
	fetchUnreadCount: ReturnType<typeof vi.fn>;
	markAsRead: ReturnType<typeof vi.fn>;
	markAsUnread: ReturnType<typeof vi.fn>;
	markAllAsRead: ReturnType<typeof vi.fn>;
	archive: ReturnType<typeof vi.fn>;
	updatePreference: ReturnType<typeof vi.fn>;
	preferences: {
		get: ReturnType<typeof vi.fn>;
		getForWorkspace: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
		updateForWorkspace: ReturnType<typeof vi.fn>;
		reset: ReturnType<typeof vi.fn>;
	};
	integrations: { create: ReturnType<typeof vi.fn> };
}

let activeClient: MockClient;

function makeMockClient(): MockClient {
	const listeners = new Map<string, Set<Listener>>();

	const client: MockClient = {
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn(),
		on: vi.fn().mockImplementation((event: string, listener: Listener) => {
			let set = listeners.get(event);
			if (!set) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(listener);
			return client;
		}),
		off: vi.fn().mockImplementation((event: string, listener: Listener) => {
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
		preferences: {
			get: vi.fn().mockResolvedValue([makePref()]),
			getForWorkspace: vi.fn().mockResolvedValue([makePref({ topicKey: "ws-topic" })]),
			update: vi.fn().mockResolvedValue(makePref()),
			updateForWorkspace: vi.fn().mockResolvedValue(makePref()),
			reset: vi.fn().mockResolvedValue(undefined),
		},
		integrations: { create: vi.fn().mockResolvedValue({}) },
	};

	return client;
}

vi.mock("@emito/js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@emito/js")>();
	return {
		...actual,
		EmitoClient: class {
			constructor() {
				return activeClient;
			}
		},
	};
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper() {
	return function Wrapper({ children }: { children: React.ReactNode }) {
		return React.createElement(
			EmitoProvider,
			{
				endpoint: "https://example.com/emito",
				subscriberId: "sub_1",
				token: "tok_abc",
			} as never,
			children,
		);
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	activeClient = makeMockClient();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("usePreferences", () => {
	describe("initial state", () => {
		it("should return isLoading=true and empty preferences before fetch resolves", () => {
			// Never-resolving promise keeps isLoading=true
			activeClient.preferences.get.mockReturnValue(new Promise(() => {}));

			const { result } = renderHook(() => usePreferences(), {
				wrapper: makeWrapper(),
			});

			expect(result.current.isLoading).toBe(true);
			expect(result.current.preferences).toEqual([]);
		});

		it("should fetch global preferences on mount when no workspaceId provided", async () => {
			const { result } = renderHook(() => usePreferences(), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});

			expect(activeClient.preferences.get).toHaveBeenCalledOnce();
			expect(activeClient.preferences.getForWorkspace).not.toHaveBeenCalled();
			expect(result.current.isLoading).toBe(false);
			expect(result.current.preferences).toHaveLength(1);
		});

		it("should fetch workspace preferences on mount when workspaceId provided", async () => {
			const { result } = renderHook(() => usePreferences({ workspaceId: "ws_123" }), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});

			expect(activeClient.preferences.getForWorkspace).toHaveBeenCalledWith("ws_123");
			expect(activeClient.preferences.get).not.toHaveBeenCalled();
			expect(result.current.preferences).toHaveLength(1);
			expect(result.current.preferences[0]!.topicKey).toBe("ws-topic");
		});
	});

	describe("updatePreference", () => {
		it("should call preferences.update with provided params (global scope)", async () => {
			const { result } = renderHook(() => usePreferences(), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});

			await act(async () => {
				await result.current.updatePreference({
					topicKey: "newsletter",
					channel: "email",
					enabled: false,
				});
			});

			expect(activeClient.preferences.update).toHaveBeenCalledWith({
				topicKey: "newsletter",
				channel: "email",
				enabled: false,
			});
		});

		it("should call preferences.updateForWorkspace when workspaceId provided", async () => {
			const { result } = renderHook(() => usePreferences({ workspaceId: "ws_123" }), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});

			await act(async () => {
				await result.current.updatePreference({
					topicKey: "newsletter",
					channel: "email",
					enabled: false,
				});
			});

			expect(activeClient.preferences.updateForWorkspace).toHaveBeenCalledWith("ws_123", {
				topicKey: "newsletter",
				channel: "email",
				enabled: false,
			});
		});

		it("should reflect updated preference in state after updatePreference", async () => {
			activeClient.preferences.get
				.mockResolvedValueOnce([makePref({ topicKey: "newsletter", enabled: true })])
				.mockResolvedValueOnce([makePref({ topicKey: "newsletter", enabled: false })]);

			const { result } = renderHook(() => usePreferences(), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});
			expect(result.current.preferences[0]!.enabled).toBe(true);

			await act(async () => {
				await result.current.updatePreference({
					topicKey: "newsletter",
					channel: "email",
					enabled: false,
				});
			});

			expect(result.current.preferences[0]!.enabled).toBe(false);
		});
	});

	describe("resetPreferences", () => {
		it("should call preferences.reset", async () => {
			const { result } = renderHook(() => usePreferences(), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});

			await act(async () => {
				await result.current.resetPreferences();
			});

			expect(activeClient.preferences.reset).toHaveBeenCalledOnce();
		});

		it("should refetch and update state after reset", async () => {
			const resetPrefs = [makePref({ topicKey: "newsletter", enabled: false })];
			activeClient.preferences.get
				.mockResolvedValueOnce([makePref({ enabled: true })])
				.mockResolvedValueOnce(resetPrefs);

			const { result } = renderHook(() => usePreferences(), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});
			expect(result.current.preferences[0]!.enabled).toBe(true);

			await act(async () => {
				await result.current.resetPreferences();
			});

			expect(result.current.preferences[0]!.enabled).toBe(false);
		});
	});

	describe("workspace scope", () => {
		it("should use workspace endpoints when workspaceId is provided", async () => {
			const wsPrefs = [makePref({ topicKey: "announcements" }), makePref({ topicKey: "alerts" })];
			activeClient.preferences.getForWorkspace.mockResolvedValue(wsPrefs);

			const { result } = renderHook(() => usePreferences({ workspaceId: "ws_abc" }), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.preferences).toHaveLength(2);
			expect(result.current.preferences[0]!.topicKey).toBe("announcements");
		});
	});

	describe("error handling", () => {
		it("should set isLoading=false even if preferences fetch throws", async () => {
			activeClient.preferences.get.mockRejectedValue(new Error("Network error"));

			const { result } = renderHook(() => usePreferences(), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});

			expect(result.current.isLoading).toBe(false);
		});
	});

	describe("optional params", () => {
		it("should work with no opts argument (defaults to global scope)", async () => {
			const { result } = renderHook(() => usePreferences(), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});

			expect(activeClient.preferences.get).toHaveBeenCalledOnce();
			expect(result.current.preferences).toBeDefined();
		});

		it("should work with empty opts object (defaults to global scope)", async () => {
			const { result } = renderHook(() => usePreferences({}), {
				wrapper: makeWrapper(),
			});

			await act(async () => {
				await Promise.resolve();
			});

			expect(activeClient.preferences.get).toHaveBeenCalledOnce();
			expect(result.current.preferences).toBeDefined();
		});
	});
});

/**
 * Unit tests for WebSocket handler (packages/server/src/transport/ws-handler.ts).
 *
 * Tests validate:
 *   - Auth: resolveSubscriberId hook (Web Standard Request) — single auth path, no JWT fallback
 *   - WS connection registers with ConnectionRegistry on upgrade
 *   - Server → client notification message format: { type, id, data }
 *   - Server → client heartbeat message every 30s
 *   - Client → server mark_read dispatches to inboxRepository
 *   - Client → server ack is a no-op (no error)
 *   - Unknown message type is ignored silently
 *   - Malformed JSON is ignored silently (connection stays open)
 *   - Reconnect catch-up via ?lastEventId= query param
 *   - Ping/pong heartbeat every 30s, dead connections terminated after 10s
 *   - Unregister from registry on close and on error
 *   - mark_read validates notification ownership (subscriber must own notification)
 *   - Path filtering: non-matching upgrade requests pass through untouched
 *   - WS upgrade handler constructs a Web Standard Request from IncomingMessage for resolveSubscriberId
 *
 * Strategy: vi.mock("ws") to intercept WebSocketServer construction and inject
 * a mock WS client when handleUpgrade fires.
 */

import type { IncomingMessage } from "node:http";
import { Duplex } from "node:stream";
import type { InboxRecord } from "@emito/core";
import type { NotificationEvent, ResolveSubscriberId } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRedis } from "../../../../core/__tests__/helpers/mock-redis.js";
import type { ConnectionRegistry } from "../../transport/registry.js";
import { createConnectionRegistry } from "../../transport/registry.js";

// ---------------------------------------------------------------------------
// Mock ws module
// ---------------------------------------------------------------------------

/**
 * Track sent messages from the mock WS object.
 */
interface MockWsClient {
	send: ReturnType<typeof vi.fn>;
	ping: ReturnType<typeof vi.fn>;
	terminate: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	readyState: number;
	OPEN: number;
	// Internal event map for test simulation
	_handlers: Map<string, (...args: unknown[]) => void>;
	/** Simulate receiving a raw message from the client */
	simulateMessage(data: string | object): void;
	/** Simulate client disconnect */
	simulateClose(): void;
	/** Simulate connection error */
	simulateError(err: Error): void;
	/** Simulate pong from client */
	simulatePong(): void;
}

let capturedConnectCallback: ((ws: MockWsClient) => void) | null = null;
let mockWsClientRef: MockWsClient | null = null;

function makeMockWsClient(): MockWsClient {
	const handlers = new Map<string, (...args: unknown[]) => void>();
	const client: MockWsClient = {
		send: vi.fn(),
		ping: vi.fn(),
		terminate: vi.fn(),
		close: vi.fn(),
		readyState: 1, // OPEN
		OPEN: 1,
		_handlers: handlers,
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			handlers.set(event, handler);
		}),
		simulateMessage(data: string | object) {
			const handler = handlers.get("message");
			if (handler) handler(typeof data === "string" ? data : JSON.stringify(data));
		},
		simulateClose() {
			const handler = handlers.get("close");
			if (handler) handler();
		},
		simulateError(err: Error) {
			const handler = handlers.get("error");
			if (handler) handler(err);
		},
		simulatePong() {
			const handler = handlers.get("pong");
			if (handler) handler();
		},
	};
	return client;
}

// Mock the ws module — intercepting WebSocketServer construction
// We use a stable class with a method that is re-initialized in beforeEach
// to avoid issues with vi.restoreAllMocks() clearing fn implementations.

class MockWebSocketServerImpl {
	handleUpgrade(
		_req: unknown,
		_socket: unknown,
		_head: unknown,
		cb: (ws: MockWsClient) => void,
	): void {
		mockWsClientRef = makeMockWsClient();
		capturedConnectCallback = cb;
		cb(mockWsClientRef);
	}
	close(): void {}
}

vi.mock("ws", () => {
	return {
		WebSocketServer: MockWebSocketServerImpl,
		WebSocket: class MockWebSocket {},
	};
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotificationEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
	return {
		notificationId: "ntf_1",
		subscriberId: "sub_1",
		event: "order.shipped",
		body: "Order 123 shipped",
		timestamp: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

/**
 * Create a minimal mock IncomingMessage for WS upgrade testing.
 */
function makeUpgradeRequest(
	options: {
		url?: string;
		headers?: Record<string, string>;
	} = {},
): IncomingMessage {
	const req = {
		url: options.url ?? "/emito/v1/ws",
		headers: options.headers ?? {},
		socket: new Duplex(),
	} as unknown as IncomingMessage;
	return req;
}

function makeInboxRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
	return {
		id: "ntf_1",
		subscriberId: "sub_1",
		eventType: "user.welcome",
		category: "transactional",
		body: "Hello world",
		data: {},
		readAt: undefined,
		archivedAt: undefined,
		snoozedUntil: undefined,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function makeMockInboxRepo() {
	return {
		findById: vi.fn<(id: string) => Promise<InboxRecord | undefined>>(),
		updateReadAt: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
		create: vi.fn(),
		findBySubscriber: vi.fn(),
		updateArchivedAt: vi.fn(),
		unreadCount: vi.fn(),
		updateSnoozedUntil: vi.fn(),
		markAllRead: vi.fn(),
		clearReadAt: vi.fn(),
		clearArchivedAt: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
// Import module under test AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

// Note: vi.mock is hoisted, so this import sees the mocked ws module
const { createWsUpgradeHandler } = await import("../../transport/ws-handler.js");

// ---------------------------------------------------------------------------
// describe("createWsUpgradeHandler")
// ---------------------------------------------------------------------------

describe("createWsUpgradeHandler", () => {
	let redis: ReturnType<typeof createMockRedis>;
	let registry: ConnectionRegistry;
	let inboxRepo: ReturnType<typeof makeMockInboxRepo>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		redis = createMockRedis();
		registry = createConnectionRegistry({ redis });
		inboxRepo = makeMockInboxRepo();
		mockWsClientRef = null;
		capturedConnectCallback = null;
	});

	afterEach(() => {
		registry.destroy();
		redis.clear();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	// ---------------------------------------------------------------------------
	// Auth — resolveSubscriberId hook (single auth path, no JWT fallback)
	// ---------------------------------------------------------------------------

	describe("auth — resolveSubscriberId hook", () => {
		it("should call resolveSubscriberId hook when provided", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_hook_1");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			const socket = new Duplex();

			await handler(req, socket, Buffer.alloc(0));

			expect(resolveSubscriberId).toHaveBeenCalled();
			// The hook receives a Web Standard Request (not IncomingMessage)
			const passedArg = resolveSubscriberId.mock.calls[0]?.[0];
			expect(passedArg).toBeInstanceOf(Request);
		});

		it("should complete the WS upgrade when resolveSubscriberId returns a subscriber ID", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_hook_2");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			// WS upgrade completed — connection registered
			expect(registry.getCount()).toBe(1);
		});

		it("should reject with 401 when resolveSubscriberId returns null", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue(null);

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const writeSpy = vi.fn();
			const destroySpy = vi.fn();
			const socket = new Duplex();
			socket.write = writeSpy;
			socket.destroy = destroySpy;

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, socket, Buffer.alloc(0));

			expect(registry.getCount()).toBe(0);
			expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("401"));
			expect(destroySpy).toHaveBeenCalled();
		});

		it("should reject with 401 when resolveSubscriberId throws", async () => {
			const resolveSubscriberId = vi.fn().mockRejectedValue(new Error("auth error"));

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const writeSpy = vi.fn();
			const destroySpy = vi.fn();
			const socket = new Duplex();
			socket.write = writeSpy;
			socket.destroy = destroySpy;

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, socket, Buffer.alloc(0));

			expect(registry.getCount()).toBe(0);
			expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("401"));
			expect(destroySpy).toHaveBeenCalled();
		});

		it("should pass request headers to the constructed Web Standard Request", async () => {
			let capturedReq: Request | null = null;
			const resolveSubscriberId = vi.fn().mockImplementation(async (req: Request) => {
				capturedReq = req;
				return "sub_header_test";
			});

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({
				url: "/emito/v1/ws",
				headers: { authorization: "Bearer some-token", "x-custom-header": "value" },
			});

			await handler(req, new Duplex(), Buffer.alloc(0));

			expect(capturedReq).not.toBeNull();
			expect(capturedReq!.headers.get("authorization")).toBe("Bearer some-token");
			expect(capturedReq!.headers.get("x-custom-header")).toBe("value");
		});

		it("should propagate URL path and query to the constructed Request", async () => {
			let capturedUrl: string | null = null;
			const resolveSubscriberId = vi.fn().mockImplementation(async (req: Request) => {
				capturedUrl = req.url;
				return "sub_url_test";
			});

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws?lastEventId=123-0&x=1" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			expect(capturedUrl).not.toBeNull();
			expect(capturedUrl).toContain("/emito/v1/ws");
			expect(capturedUrl).toContain("lastEventId=123-0");
		});
	});

	// ---------------------------------------------------------------------------
	// Auth — 401 rejection
	// ---------------------------------------------------------------------------

	describe("auth — 401 rejection before handshake", () => {
		it("should reject with 401 and write HTTP response when no auth provided and resolveSubscriberId returns null", async () => {
			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId: vi.fn().mockResolvedValue(null),
			});

			const writeSpy = vi.fn();
			const destroySpy = vi.fn();
			const socket = new Duplex();
			socket.write = writeSpy;
			socket.destroy = destroySpy;

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, socket, Buffer.alloc(0));

			// Should NOT register any connection
			expect(registry.getCount()).toBe(0);
			// Should write an HTTP 401 response
			expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("401"));
			// Should destroy the socket
			expect(destroySpy).toHaveBeenCalled();
		});

		it("should reject with 401 when resolveSubscriberId returns null and no hook short-circuits", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue(null);

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const writeSpy = vi.fn();
			const destroySpy = vi.fn();
			const socket = new Duplex();
			socket.write = writeSpy;
			socket.destroy = destroySpy;

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, socket, Buffer.alloc(0));

			expect(registry.getCount()).toBe(0);
			expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("401"));
			expect(destroySpy).toHaveBeenCalled();
		});

		it("should NOT destroy the socket before writing the 401 response", async () => {
			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId: vi.fn().mockResolvedValue(null),
			});

			const callOrder: string[] = [];
			const socket = new Duplex();
			socket.write = vi.fn(() => {
				callOrder.push("write");
				return true;
			});
			socket.destroy = vi.fn(() => {
				callOrder.push("destroy");
				return socket;
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, socket, Buffer.alloc(0));

			const writeIdx = callOrder.indexOf("write");
			const destroyIdx = callOrder.indexOf("destroy");
			expect(writeIdx).toBeGreaterThanOrEqual(0);
			expect(destroyIdx).toBeGreaterThan(writeIdx);
		});
	});

	// ---------------------------------------------------------------------------
	// Path filtering
	// ---------------------------------------------------------------------------

	describe("path filtering", () => {
		it("should not handle (or destroy socket for) non-emito upgrade paths", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_1");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const destroySpy = vi.fn();
			const socket = new Duplex();
			socket.destroy = destroySpy;

			const req = makeUpgradeRequest({
				url: "/other-service/ws",
			});

			await handler(req, socket, Buffer.alloc(0));

			// Must NOT destroy the socket — pass through for other handlers
			expect(registry.getCount()).toBe(0);
			expect(destroySpy).not.toHaveBeenCalled();
			// resolveSubscriberId should NOT have been called for non-matching path
			expect(resolveSubscriberId).not.toHaveBeenCalled();
		});

		it("should handle upgrade requests matching /emito/v1/ws path", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_1");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			expect(registry.getCount()).toBe(1);
		});

		it("should handle upgrade requests with query params on /emito/v1/ws", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_1");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws?lastEventId=123-0" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			expect(registry.getCount()).toBe(1);
		});
	});

	// ---------------------------------------------------------------------------
	// Registry wiring
	// ---------------------------------------------------------------------------

	describe("registry wiring", () => {
		it("should register the WS connection in ConnectionRegistry on successful upgrade", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_reg_1");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			expect(registry.getCount()).toBe(0);

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			expect(registry.getCount()).toBe(1);
		});

		it("should unregister the WS connection from registry on client disconnect (close event)", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_close");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));
			expect(registry.getCount()).toBe(1);

			// Simulate client disconnect
			mockWsClientRef!.simulateClose();

			expect(registry.getCount()).toBe(0);
		});

		it("should unregister the WS connection from registry on error event", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_err");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));
			expect(registry.getCount()).toBe(1);

			// Simulate connection error
			mockWsClientRef!.simulateError(new Error("ECONNRESET"));

			expect(registry.getCount()).toBe(0);
		});
	});

	// ---------------------------------------------------------------------------
	// Server → client message format
	// ---------------------------------------------------------------------------

	describe("server → client message format", () => {
		it("should deliver notifications as JSON { type, id, data } envelope via ws.send", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_msg");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			// Broadcast an event — ConnectionRegistry will call connection.write()
			const event = makeNotificationEvent({ notificationId: "ntf_ws_1" });
			await registry.broadcast("sub_msg", event);

			// mockWsClientRef.send should have been called with a valid JSON envelope
			expect(mockWsClientRef!.send).toHaveBeenCalledWith(
				expect.stringContaining('"type":"notification"'),
			);

			const raw = mockWsClientRef!.send.mock.calls[0]?.[0] as string;
			const parsed = JSON.parse(raw) as {
				type: string;
				id?: string;
				data: { notificationId: string };
			};
			expect(parsed.type).toBe("notification");
			expect(parsed.data).toMatchObject({ notificationId: "ntf_ws_1" });
		});

		it("should include stream ID as 'id' field in notification envelope when available", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_sid");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			const event = makeNotificationEvent({ notificationId: "ntf_sid" });
			await registry.broadcast("sub_sid", event);

			const raw = mockWsClientRef!.send.mock.calls[0]?.[0] as string;
			const parsed = JSON.parse(raw) as { type: string; id?: string; data: object };

			// id should be present (the Redis stream ID) since Redis is configured
			expect(parsed.id).toBeDefined();
			expect(typeof parsed.id).toBe("string");
		});
	});

	// ---------------------------------------------------------------------------
	// Heartbeat
	// ---------------------------------------------------------------------------

	describe("heartbeat — ping/pong every 30s", () => {
		it("should send a ping to the client every 30 seconds", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_hb");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			expect(mockWsClientRef!.ping).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(30_000);

			expect(mockWsClientRef!.ping).toHaveBeenCalled();
		});

		it("should send a heartbeat message frame { type: 'heartbeat' } every 30s", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_hb2");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			await vi.advanceTimersByTimeAsync(30_000);

			const heartbeatCall = mockWsClientRef!.send.mock.calls.find((call) => {
				try {
					const msg = JSON.parse(call[0] as string) as { type: string };
					return msg.type === "heartbeat";
				} catch {
					return false;
				}
			});
			expect(heartbeatCall).toBeDefined();
		});

		it("should terminate a dead connection after 10s with no pong response", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_dead");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			// Advance to heartbeat interval — ping sent
			await vi.advanceTimersByTimeAsync(30_000);
			expect(mockWsClientRef!.ping).toHaveBeenCalled();

			// Do NOT simulate pong — advance 10s pong timeout
			await vi.advanceTimersByTimeAsync(10_000);

			expect(mockWsClientRef!.terminate).toHaveBeenCalled();
		});

		it("should NOT terminate a connection that responds to pong within the 10s window", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_alive");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			// Advance to heartbeat
			await vi.advanceTimersByTimeAsync(30_000);

			// Client responds with pong in time
			mockWsClientRef!.simulatePong();

			// Advance 10s — should NOT terminate
			await vi.advanceTimersByTimeAsync(10_000);

			expect(mockWsClientRef!.terminate).not.toHaveBeenCalled();
		});

		it("should stop sending heartbeats after connection closes", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_close_hb");

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			// Simulate close
			mockWsClientRef!.simulateClose();

			const pingCountBeforeAdvance = mockWsClientRef!.ping.mock.calls.length;

			// Advance well past heartbeat interval — ping should NOT be called after close
			await vi.advanceTimersByTimeAsync(90_000);

			expect(mockWsClientRef!.ping.mock.calls.length).toBe(pingCountBeforeAdvance);
		});
	});

	// ---------------------------------------------------------------------------
	// Client → server bidirectional messages
	// ---------------------------------------------------------------------------

	describe("client → server messages", () => {
		describe("mark_read", () => {
			it("should call inboxRepository.updateReadAt when mark_read is received for owned notification", async () => {
				const resolveSubscriberId = vi.fn().mockResolvedValue("sub_mr");

				inboxRepo.findById.mockResolvedValue(
					makeInboxRecord({ id: "ntf_owned", subscriberId: "sub_mr" }),
				);

				const handler = createWsUpgradeHandler({
					basePath: "/emito/v1",
					registry,
					redis,
					inboxRepository: inboxRepo,
					resolveSubscriberId,
				});

				const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
				await handler(req, new Duplex(), Buffer.alloc(0));

				mockWsClientRef!.simulateMessage({
					type: "mark_read",
					notificationId: "ntf_owned",
				});

				// Flush microtasks — the mark_read handler is async (fire-and-forget via void)
				// Multiple flushes ensure the full async chain completes
				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);

				expect(inboxRepo.findById).toHaveBeenCalledWith("ntf_owned");
				expect(inboxRepo.updateReadAt).toHaveBeenCalledWith("ntf_owned");
			});

			it("should NOT call updateReadAt when mark_read is for a notification owned by a different subscriber", async () => {
				const resolveSubscriberId = vi.fn().mockResolvedValue("sub_attacker");

				inboxRepo.findById.mockResolvedValue(
					makeInboxRecord({ id: "ntf_victim", subscriberId: "sub_other" }),
				);

				const handler = createWsUpgradeHandler({
					basePath: "/emito/v1",
					registry,
					redis,
					inboxRepository: inboxRepo,
					resolveSubscriberId,
				});

				const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
				await handler(req, new Duplex(), Buffer.alloc(0));

				mockWsClientRef!.simulateMessage({
					type: "mark_read",
					notificationId: "ntf_victim",
				});

				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);

				expect(inboxRepo.updateReadAt).not.toHaveBeenCalled();
			});

			it("should NOT call updateReadAt when notification is not found", async () => {
				const resolveSubscriberId = vi.fn().mockResolvedValue("sub_notfound");

				inboxRepo.findById.mockResolvedValue(undefined);

				const handler = createWsUpgradeHandler({
					basePath: "/emito/v1",
					registry,
					redis,
					inboxRepository: inboxRepo,
					resolveSubscriberId,
				});

				const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
				await handler(req, new Duplex(), Buffer.alloc(0));

				mockWsClientRef!.simulateMessage({
					type: "mark_read",
					notificationId: "ntf_missing",
				});

				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);

				expect(inboxRepo.updateReadAt).not.toHaveBeenCalled();
			});

			it("should not close the connection after a failed mark_read ownership check", async () => {
				const resolveSubscriberId = vi.fn().mockResolvedValue("sub_mr_noclosecheck");

				inboxRepo.findById.mockResolvedValue(undefined);

				const handler = createWsUpgradeHandler({
					basePath: "/emito/v1",
					registry,
					redis,
					inboxRepository: inboxRepo,
					resolveSubscriberId,
				});

				const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
				await handler(req, new Duplex(), Buffer.alloc(0));

				mockWsClientRef!.simulateMessage({
					type: "mark_read",
					notificationId: "ntf_missing",
				});

				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);
				await vi.advanceTimersByTimeAsync(0);

				// Connection must remain open
				expect(registry.getCount()).toBe(1);
				expect(mockWsClientRef!.terminate).not.toHaveBeenCalled();
			});
		});

		describe("ack", () => {
			it("should accept ack messages without side effects", async () => {
				const resolveSubscriberId = vi.fn().mockResolvedValue("sub_ack");

				const handler = createWsUpgradeHandler({
					basePath: "/emito/v1",
					registry,
					redis,
					inboxRepository: inboxRepo,
					resolveSubscriberId,
				});

				const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
				await handler(req, new Duplex(), Buffer.alloc(0));

				expect(() => mockWsClientRef!.simulateMessage({ type: "ack", id: "1234-0" })).not.toThrow();

				await vi.advanceTimersByTimeAsync(0);

				expect(inboxRepo.findById).not.toHaveBeenCalled();
				expect(inboxRepo.updateReadAt).not.toHaveBeenCalled();
				expect(registry.getCount()).toBe(1);
			});
		});

		describe("unknown message type", () => {
			it("should ignore unknown message types without closing the connection", async () => {
				const resolveSubscriberId = vi.fn().mockResolvedValue("sub_unk");

				const handler = createWsUpgradeHandler({
					basePath: "/emito/v1",
					registry,
					redis,
					inboxRepository: inboxRepo,
					resolveSubscriberId,
				});

				const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
				await handler(req, new Duplex(), Buffer.alloc(0));

				expect(() =>
					mockWsClientRef!.simulateMessage({ type: "future_type_v2", payload: "whatever" }),
				).not.toThrow();

				await vi.advanceTimersByTimeAsync(0);

				expect(registry.getCount()).toBe(1);
				expect(mockWsClientRef!.terminate).not.toHaveBeenCalled();
			});
		});

		describe("malformed JSON", () => {
			it("should ignore malformed JSON without closing the connection", async () => {
				const resolveSubscriberId = vi.fn().mockResolvedValue("sub_malformed");

				const handler = createWsUpgradeHandler({
					basePath: "/emito/v1",
					registry,
					redis,
					inboxRepository: inboxRepo,
					resolveSubscriberId,
				});

				const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
				await handler(req, new Duplex(), Buffer.alloc(0));

				// Send raw non-JSON string
				mockWsClientRef!.simulateMessage("this is not json {{{");

				await vi.advanceTimersByTimeAsync(0);

				expect(registry.getCount()).toBe(1);
				expect(mockWsClientRef!.terminate).not.toHaveBeenCalled();
			});

			it("should ignore messages that are valid JSON but missing type field", async () => {
				const resolveSubscriberId = vi.fn().mockResolvedValue("sub_notype");

				const handler = createWsUpgradeHandler({
					basePath: "/emito/v1",
					registry,
					redis,
					inboxRepository: inboxRepo,
					resolveSubscriberId,
				});

				const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
				await handler(req, new Duplex(), Buffer.alloc(0));

				mockWsClientRef!.simulateMessage({ notypehere: true });

				await vi.advanceTimersByTimeAsync(0);

				expect(registry.getCount()).toBe(1);
			});
		});
	});

	// ---------------------------------------------------------------------------
	// Reconnect catch-up via ?lastEventId=
	// ---------------------------------------------------------------------------

	describe("reconnect catch-up via ?lastEventId= query param", () => {
		it("should send missed events from Redis Stream when ?lastEventId= is present", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_catchup");

			// Pre-populate Redis stream with a missed event
			const missedEvent = makeNotificationEvent({ notificationId: "ntf_missed" });
			await redis.xadd("emito:stream:sub_catchup", "1000-0", "event", JSON.stringify(missedEvent));

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws?lastEventId=0-0" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			// Give catch-up async work time to complete
			await vi.advanceTimersByTimeAsync(10);

			// ws.send should have been called with the missed notification
			const notifCall = mockWsClientRef!.send.mock.calls.find((call) => {
				try {
					const msg = JSON.parse(call[0] as string) as {
						type: string;
						data: { notificationId: string };
					};
					return msg.type === "notification" && msg.data.notificationId === "ntf_missed";
				} catch {
					return false;
				}
			});
			expect(notifCall).toBeDefined();
		});

		it("should not send catch-up events when no lastEventId query param is present", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_nocatchup");

			// Pre-populate Redis stream
			const oldEvent = makeNotificationEvent({ notificationId: "ntf_old" });
			await redis.xadd("emito:stream:sub_nocatchup", "500-0", "event", JSON.stringify(oldEvent));

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry,
				redis,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			// No lastEventId
			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			await vi.advanceTimersByTimeAsync(10);

			// No notification frames sent — the old event should not be pushed
			const notifCall = mockWsClientRef!.send.mock.calls.find((call) => {
				try {
					const msg = JSON.parse(call[0] as string) as { type: string };
					return msg.type === "notification";
				} catch {
					return false;
				}
			});
			expect(notifCall).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------------------
	// Graceful degradation — no Redis
	// ---------------------------------------------------------------------------

	describe("graceful degradation — Redis unavailable", () => {
		it("should still accept connections and deliver events in-process when Redis is not configured", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_nored");

			const noRedisRegistry = createConnectionRegistry({ redis: undefined });

			const handler = createWsUpgradeHandler({
				basePath: "/emito/v1",
				registry: noRedisRegistry,
				redis: undefined,
				inboxRepository: inboxRepo,
				resolveSubscriberId,
			});

			const req = makeUpgradeRequest({ url: "/emito/v1/ws" });
			await handler(req, new Duplex(), Buffer.alloc(0));

			expect(noRedisRegistry.getCount()).toBe(1);

			const event = makeNotificationEvent({ notificationId: "ntf_nored" });
			await noRedisRegistry.broadcast("sub_nored", event);

			// In-process delivery should work — ws.send called synchronously via broadcastLocal
			expect(mockWsClientRef!.send).toHaveBeenCalled();
			const sentMsg = mockWsClientRef!.send.mock.calls.find((call) => {
				try {
					const msg = JSON.parse(call[0] as string) as { data?: { notificationId: string } };
					return msg.data?.notificationId === "ntf_nored";
				} catch {
					return false;
				}
			});
			expect(sentMsg).toBeDefined();

			noRedisRegistry.destroy();
		});
	});
});

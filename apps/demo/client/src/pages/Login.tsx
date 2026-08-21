import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type AuthUser, isAuthenticated, setAuth } from "../lib/auth";

interface DemoUser {
	id: string;
	name: string;
	email: string;
	role: "trader" | "admin";
}

const ROLE_LABELS: Record<string, string> = {
	trader: "Trader",
	admin: "Admin",
};

const ROLE_COLORS: Record<string, string> = {
	trader: "bg-blue-100 text-blue-800",
	admin: "bg-purple-100 text-purple-800",
};

export function Login() {
	const navigate = useNavigate();
	const [users, setUsers] = useState<DemoUser[]>([]);
	const [loading, setLoading] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (isAuthenticated()) {
			navigate("/", { replace: true });
			return;
		}

		fetch("/api/users")
			.then((r) => r.json())
			.then((data) => setUsers(data as DemoUser[]))
			.catch(() => {
				setUsers([
					{ id: "trader_alice", name: "Alice Chen", email: "alice@demo.emito.dev", role: "trader" },
					{ id: "trader_bob", name: "Bob Martinez", email: "bob@demo.emito.dev", role: "trader" },
					{ id: "admin_charlie", name: "Charlie Park", email: "charlie@demo.emito.dev", role: "admin" },
				]);
			});
	}, [navigate]);

	async function handleLogin(userId: string) {
		setLoading(userId);
		setError(null);

		try {
			const res = await fetch("/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userId }),
			});

			if (!res.ok) {
				const data = await res.json();
				setError(data.error ?? "Login failed");
				return;
			}

			const { token, user } = (await res.json()) as { token: string; user: AuthUser };
			setAuth(token, user);
			navigate("/", { replace: true });
		} catch {
			setError("Failed to connect to server");
		} finally {
			setLoading(null);
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-slate-50">
			<div className="max-w-md w-full mx-4">
				<div className="text-center mb-8">
					<h1 className="text-3xl font-bold text-slate-900">Acme Trading</h1>
					<p className="text-slate-500 mt-2">Emito Notification Demo</p>
				</div>

				{error && (
					<div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
				)}

				<div className="space-y-3">
					{users.map((user) => (
						<button
							key={user.id}
							onClick={() => handleLogin(user.id)}
							disabled={loading !== null}
							className="w-full p-4 bg-white rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<div className="flex items-center gap-4">
								<div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-600">
									{user.name.split(" ").map((n) => n[0]).join("")}
								</div>
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<span className="font-medium text-slate-900">{user.name}</span>
										<span className={`text-xs px-2 py-0.5 rounded-full ${ROLE_COLORS[user.role] ?? ""}`}>
											{ROLE_LABELS[user.role] ?? user.role}
										</span>
									</div>
									<div className="text-sm text-slate-500">{user.email}</div>
								</div>
								{loading === user.id && (
									<div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
								)}
							</div>
						</button>
					))}
				</div>

				<p className="text-center text-xs text-slate-400 mt-6">
					Select a demo user to explore Emito notifications
				</p>
			</div>
		</div>
	);
}

import { getUser } from "../lib/auth";

const ROLE_LABELS: Record<string, string> = {
	trader: "Trader",
	admin: "Admin",
};

export function Dashboard() {
	const user = getUser();

	if (!user) return null;

	return (
		<div className="p-8 max-w-3xl mx-auto">
			<h1 className="text-2xl font-bold text-slate-900 mb-6">Dashboard</h1>

			<div className="bg-white rounded-xl border border-slate-200 p-6">
				<h2 className="text-lg font-semibold text-slate-900 mb-4">
					Welcome back, {user.name}
				</h2>
				<div className="space-y-2 text-sm text-slate-600">
					<p>
						<span className="font-medium text-slate-700">Email:</span> {user.email}
					</p>
					<p>
						<span className="font-medium text-slate-700">Role:</span>{" "}
						{ROLE_LABELS[user.role] ?? user.role}
					</p>
					<p>
						<span className="font-medium text-slate-700">Workspace:</span> Acme
						Trading
					</p>
				</div>
			</div>

			<div className="mt-6 bg-white rounded-xl border border-slate-200 p-6">
				<h2 className="text-lg font-semibold text-slate-900 mb-3">
					Getting Started
				</h2>
				<ul className="space-y-2 text-sm text-slate-600">
					<li>
						Go to <span className="font-medium text-slate-700">Portfolio</span> to
						trigger notification events
					</li>
					<li>
						Watch the bell icon for real-time unread count updates
					</li>
					<li>
						Click the bell to open the inbox popover with notification history
					</li>
					<li>
						Visit <span className="font-medium text-slate-700">Settings</span> to
						manage notification preferences per channel
					</li>
				</ul>
			</div>
		</div>
	);
}

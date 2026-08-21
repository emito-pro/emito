import { InboxPopover, NotificationBell } from "@emito/react";
import { Link, useNavigate } from "react-router-dom";
import { clearAuth, getUser } from "../lib/auth";

export function Header() {
	const navigate = useNavigate();
	const user = getUser();

	function handleLogout() {
		clearAuth();
		navigate("/login", { replace: true });
	}

	return (
		<header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
			<div className="flex items-center gap-6">
				<Link to="/" className="text-lg font-bold text-slate-900">
					Acme Trading
				</Link>
				<nav className="flex gap-4">
					<Link to="/" className="text-sm text-slate-600 hover:text-slate-900">
						Dashboard
					</Link>
					<Link to="/portfolio" className="text-sm text-slate-600 hover:text-slate-900">
						Portfolio
					</Link>
					<Link to="/settings" className="text-sm text-slate-600 hover:text-slate-900">
						Settings
					</Link>
				</nav>
			</div>
			<div className="flex items-center gap-4">
				<InboxPopover bell={<NotificationBell />} />
				{user && (
					<div className="flex items-center gap-3">
						<span className="text-sm text-slate-600">{user.name}</span>
						<button
							type="button"
							onClick={handleLogout}
							className="text-sm text-slate-500 hover:text-slate-700"
						>
							Logout
						</button>
					</div>
				)}
			</div>
		</header>
	);
}

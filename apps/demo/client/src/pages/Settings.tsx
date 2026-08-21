import { useEffect, useMemo, useState } from "react";
import { PreferenceCenter } from "@emito/react";
import type { TopicDefinition } from "@emito/react";
import type { WorkspaceDefault } from "@emito/types";
import { WorkspaceAdmin } from "../components/WorkspaceAdmin";
import { getToken, getUser } from "../lib/auth";

const WORKSPACE_ID = "ws_acme-trading";

type Tab = "personal" | "workspace-defaults" | "workspace-forced";

export function Settings() {
	const user = getUser();
	const isAdmin = user?.role === "admin";

	const tabs: { id: Tab; label: string; adminOnly: boolean }[] = useMemo(
		() => [
			{ id: "personal", label: "Personal", adminOnly: false },
			{ id: "workspace-defaults", label: "Workspace Defaults", adminOnly: true },
			{ id: "workspace-forced", label: "Workspace Forced", adminOnly: true },
		],
		[],
	);

	const visibleTabs = isAdmin ? tabs : tabs.filter((t) => !t.adminOnly);
	const [activeTab, setActiveTab] = useState<Tab>("personal");
	const [topics, setTopics] = useState<TopicDefinition[]>([]);
	const [workspaceDefaults, setWorkspaceDefaults] = useState<WorkspaceDefault[]>([]);

	useEffect(() => {
		fetch("/api/topics")
			.then((r) => r.json())
			.then((data) => setTopics(data as TopicDefinition[]))
			.catch(() => {});
	}, []);

	useEffect(() => {
		if (activeTab !== "personal") {
			const token = getToken();
			fetch(`/emito/workspace/${WORKSPACE_ID}/defaults`, {
				headers: { Authorization: `Bearer ${token}` },
			})
				.then((r) => r.json())
				.then((data) =>
					setWorkspaceDefaults(
						(data as { data: { defaults: WorkspaceDefault[] } }).data.defaults,
					),
				)
				.catch(() => {});
		}
	}, [activeTab]);

	return (
		<div className="p-8 max-w-3xl mx-auto">
			<h1 className="text-2xl font-bold text-slate-900 mb-6">
				Settings
				{isAdmin && (
					<span className="ml-2 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full align-middle">
						Admin
					</span>
				)}
			</h1>

			{visibleTabs.length > 1 && (
				<div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-lg">
					{visibleTabs.map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => setActiveTab(tab.id)}
							className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
								activeTab === tab.id
									? "bg-white text-slate-900 shadow-sm"
									: "text-slate-500 hover:text-slate-700"
							}`}
						>
							{tab.label}
						</button>
					))}
				</div>
			)}

			{activeTab === "personal" && (
				<>
					<div className="bg-white rounded-xl border border-slate-200 p-6">
						<h2 className="text-lg font-semibold text-slate-900 mb-1">
							Your Notification Preferences
						</h2>
						<p className="text-sm text-slate-500 mb-4">
							Control which channels each notification type uses.
						</p>
						<PreferenceCenter
							topics={topics}
							workspaceDefaults={workspaceDefaults}
							showIntegrations
						/>
					</div>

					{!isAdmin && workspaceDefaults.some((d) => d.isMandatory) && (
						<p className="mt-3 text-xs text-slate-400 text-center">
							Some channels are locked by your workspace admin.
							Switch to workspace view to see enforced settings.
						</p>
					)}
				</>
			)}

			{activeTab === "workspace-defaults" && (
				<div className="bg-white rounded-xl border border-slate-200 p-6">
					<h2 className="text-lg font-semibold text-slate-900 mb-1">
						Workspace Defaults
					</h2>
					<WorkspaceAdmin
						workspaceId={WORKSPACE_ID}
						topics={topics}
						mode="defaults"
					/>
				</div>
			)}

			{activeTab === "workspace-forced" && (
				<div className="bg-white rounded-xl border border-slate-200 p-6">
					<h2 className="text-lg font-semibold text-slate-900 mb-1">
						Workspace Forced Settings
					</h2>
					<WorkspaceAdmin
						workspaceId={WORKSPACE_ID}
						topics={topics}
						mode="forced"
					/>
				</div>
			)}
		</div>
	);
}

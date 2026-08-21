import { useCallback, useEffect, useMemo, useState } from "react";
import type { Channel } from "@emito/types";
import { getToken } from "../lib/auth";

interface TopicInfo {
	topicKey: string;
	label: string;
	channels: Channel[];
}

interface DefaultRecord {
	topicKey: string;
	channel: Channel;
	enabled: boolean;
	isMandatory: boolean;
}

interface WorkspaceAdminProps {
	workspaceId: string;
	topics: TopicInfo[];
	mode: "defaults" | "forced";
}

export function WorkspaceAdmin({ workspaceId, topics, mode }: WorkspaceAdminProps) {
	const [defaults, setDefaults] = useState<DefaultRecord[]>([]);
	const isMandatory = mode === "forced";

	const fetchDefaults = useCallback(() => {
		const token = getToken();
		fetch(`/emito/workspace/${workspaceId}/defaults`, {
			headers: { Authorization: `Bearer ${token}` },
		})
			.then((r) => r.json())
			.then((data) => setDefaults((data as { data: { defaults: DefaultRecord[] } }).data.defaults))
			.catch(() => {});
	}, [workspaceId]);

	useEffect(() => {
		fetchDefaults();
	}, [fetchDefaults]);

	const columns = useMemo(() => {
		const set = new Set<Channel>();
		for (const t of topics) for (const ch of t.channels) set.add(ch);
		return Array.from(set);
	}, [topics]);

	const lookup = useMemo(() => {
		const map = new Map<string, DefaultRecord>();
		for (const d of defaults) {
			if (isMandatory ? d.isMandatory : !d.isMandatory) {
				map.set(`${d.topicKey}:${d.channel}`, d);
			}
		}
		return map;
	}, [defaults, isMandatory]);

	async function handleToggle(topicKey: string, channel: Channel, enabled: boolean) {
		const token = getToken();
		await fetch(`/emito/workspace/${workspaceId}/defaults`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ topicKey, channel, enabled, isMandatory }),
		});
		fetchDefaults();
	}

	return (
		<div>
			<p className="text-sm text-slate-500 mb-4">
				{isMandatory
					? "Forced channels cannot be overridden by workspace members. Use for compliance-critical notifications."
					: "Default preferences for new workspace members. Users can override these in their personal settings."}
			</p>
			<table className="w-full border-collapse text-sm">
				<thead>
					<tr className="border-b border-slate-200">
						<th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
							Topic
						</th>
						{columns.map((ch) => (
							<th
								key={ch}
								className="py-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-center"
							>
								{ch}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{topics.map((topic) => (
						<tr key={topic.topicKey} className="border-b border-slate-100">
							<td className="py-3 px-3 text-slate-700">{topic.label}</td>
							{columns.map((channel) => {
								const applicable = topic.channels.includes(channel);
								if (!applicable) {
									return (
										<td key={channel} className="py-3 px-3 text-center text-slate-300">
											--
										</td>
									);
								}

								const record = lookup.get(`${topic.topicKey}:${channel}`);
								const checked = record?.enabled ?? false;

								return (
									<td key={channel} className="py-3 px-3 text-center">
										<button
											type="button"
											role="switch"
											aria-checked={checked}
											aria-label={`${topic.label} ${channel}`}
											onClick={() => handleToggle(topic.topicKey, channel, !checked)}
											className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
												checked ? "bg-indigo-500" : "bg-slate-300"
											}`}
										>
											<span
												className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
													checked ? "translate-x-[18px]" : "translate-x-[2px]"
												}`}
											/>
										</button>
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

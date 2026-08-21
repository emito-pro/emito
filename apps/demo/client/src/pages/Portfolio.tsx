import { useState } from "react";
import { triggerEvent } from "../lib/api";

interface EventCard {
	event: string;
	title: string;
	description: string;
	channels: string[];
	color: string;
}

const EVENTS: EventCard[] = [
	{
		event: "order.fill",
		title: "Fill Order",
		description: "Simulate an order being filled — triggers email, in-app, and push.",
		channels: ["email", "inApp", "push"],
		color: "bg-green-50 border-green-200",
	},
	{
		event: "price.alert",
		title: "Price Alert",
		description: "Simulate a price threshold breach — triggers in-app, push, and SMS.",
		channels: ["inApp", "push", "sms"],
		color: "bg-blue-50 border-blue-200",
	},
	{
		event: "security.alert",
		title: "Security Event",
		description: "Simulate a security alert — triggers all channels, bypasses preferences.",
		channels: ["email", "inApp", "push", "sms"],
		color: "bg-red-50 border-red-200",
	},
	{
		event: "team.invite",
		title: "Team Invite",
		description: "Simulate a team invitation — triggers email and in-app.",
		channels: ["email", "inApp"],
		color: "bg-purple-50 border-purple-200",
	},
];

const CHANNEL_BADGE: Record<string, string> = {
	email: "bg-slate-100 text-slate-700",
	inApp: "bg-blue-100 text-blue-700",
	push: "bg-amber-100 text-amber-700",
	sms: "bg-green-100 text-green-700",
};

export function Portfolio() {
	const [loading, setLoading] = useState<string | null>(null);
	const [feedback, setFeedback] = useState<Record<string, { ok: boolean; message: string }>>({});

	async function handleTrigger(event: string) {
		setLoading(event);
		setFeedback((prev) => ({ ...prev, [event]: undefined! }));

		try {
			const result = await triggerEvent(event);
			setFeedback((prev) => ({
				...prev,
				[event]: {
					ok: true,
					message: `Sent — ${result.channels.length} channel(s) routed`,
				},
			}));
		} catch (err) {
			setFeedback((prev) => ({
				...prev,
				[event]: { ok: false, message: String(err) },
			}));
		} finally {
			setLoading(null);
		}
	}

	return (
		<div className="p-8 max-w-3xl mx-auto">
			<h1 className="text-2xl font-bold text-slate-900 mb-2">Portfolio</h1>
			<p className="text-sm text-slate-500 mb-6">
				Trigger notification events to see Emito's multi-channel delivery in action.
			</p>

			<div className="grid gap-4 sm:grid-cols-2">
				{EVENTS.map((card) => {
					const fb = feedback[card.event];
					return (
						<div
							key={card.event}
							className={`rounded-xl border p-5 ${card.color}`}
						>
							<h3 className="font-semibold text-slate-900 mb-1">
								{card.title}
							</h3>
							<p className="text-sm text-slate-600 mb-3">
								{card.description}
							</p>
							<div className="flex flex-wrap gap-1.5 mb-4">
								{card.channels.map((ch) => (
									<span
										key={ch}
										className={`text-xs px-2 py-0.5 rounded-full ${CHANNEL_BADGE[ch] ?? "bg-slate-100 text-slate-600"}`}
									>
										{ch}
									</span>
								))}
							</div>
							<button
								type="button"
								disabled={loading !== null}
								onClick={() => handleTrigger(card.event)}
								className="w-full py-2 px-4 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
							>
								{loading === card.event ? "Sending..." : "Trigger"}
							</button>
							{fb && (
								<p
									className={`mt-2 text-xs ${fb.ok ? "text-green-700" : "text-red-700"}`}
								>
									{fb.message}
								</p>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

import { EmitoProvider } from "@emito/react-hooks";
import type { ReactNode } from "react";
import { getToken, getUser } from "../lib/auth";

export function DemoEmitoProvider({ children }: { children: ReactNode }) {
	const token = getToken();
	const user = getUser();

	if (!token || !user) {
		return <>{children}</>;
	}

	return (
		<EmitoProvider endpoint={`${window.location.origin}/emito`} subscriberId={user.id} token={token}>
			{children}
		</EmitoProvider>
	);
}

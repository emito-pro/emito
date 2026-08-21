const TOKEN_KEY = "emito_demo_token";
const USER_KEY = "emito_demo_user";

export interface AuthUser {
	id: string;
	name: string;
	email: string;
	role: "trader" | "admin";
}

export function getToken(): string | null {
	return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
	const raw = localStorage.getItem(USER_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as AuthUser;
	} catch {
		localStorage.removeItem(USER_KEY);
		return null;
	}
}

export function setAuth(token: string, user: AuthUser): void {
	localStorage.setItem(TOKEN_KEY, token);
	localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(USER_KEY);
}

// Client-side expiry check only — signature is verified server-side on each API call
export function isAuthenticated(): boolean {
	const token = getToken();
	if (!token) return false;

	try {
		const payload = JSON.parse(atob(token.split(".")[1]!));
		const now = Math.floor(Date.now() / 1000);
		return typeof payload.exp === "number" ? now < payload.exp : true;
	} catch {
		return false;
	}
}

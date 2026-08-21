import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { ToastContainer } from "./components/ToastContainer";
import { isAuthenticated } from "./lib/auth";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Portfolio } from "./pages/Portfolio";
import { Settings } from "./pages/Settings";
import { DemoEmitoProvider } from "./providers/EmitoProvider";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
	if (!isAuthenticated()) {
		return <Navigate to="/login" replace />;
	}
	return <>{children}</>;
}

function Layout({ children }: { children: React.ReactNode }) {
	return (
		<DemoEmitoProvider>
			<div className="min-h-screen bg-slate-50">
				<Header />
				<main>{children}</main>
				<ToastContainer />
			</div>
		</DemoEmitoProvider>
	);
}

export function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route path="/login" element={<Login />} />
				<Route
					path="/"
					element={
						<ProtectedRoute>
							<Layout><Dashboard /></Layout>
						</ProtectedRoute>
					}
				/>
				<Route
					path="/portfolio"
					element={
						<ProtectedRoute>
							<Layout><Portfolio /></Layout>
						</ProtectedRoute>
					}
				/>
				<Route
					path="/settings"
					element={
						<ProtectedRoute>
							<Layout><Settings /></Layout>
						</ProtectedRoute>
					}
				/>
			</Routes>
		</BrowserRouter>
	);
}

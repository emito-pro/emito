import { describe, expect, it, vi } from "vitest";

const selectMock = vi.fn().mockResolvedValue("express");

vi.mock("@clack/prompts", () => ({
	multiselect: vi.fn().mockResolvedValue(["email"]),
	text: vi.fn().mockResolvedValue("secret-value"),
	confirm: vi.fn().mockResolvedValue(true),
	select: selectMock,
	isCancel: vi.fn().mockReturnValue(false),
}));

describe("createClackWizard", () => {
	it("selectChannels returns the user's multiselect answer", async () => {
		const { createClackWizard } = await import("../wizard.js");
		const wizard = createClackWizard();
		await expect(wizard.selectChannels()).resolves.toEqual(["email"]);
	});

	it("confirmPlan returns the user's confirm answer", async () => {
		const { createClackWizard } = await import("../wizard.js");
		const wizard = createClackWizard();
		await expect(wizard.confirmPlan("plan summary")).resolves.toBe(true);
	});

	it("promptMissingEnvVar returns the user's text answer", async () => {
		const { createClackWizard } = await import("../wizard.js");
		const wizard = createClackWizard();
		await expect(wizard.promptMissingEnvVar("EMITO_JWT_SECRET")).resolves.toBe("secret-value");
	});

	it("selectFramework returns the user's choice and pre-selects the suggestion", async () => {
		const { createClackWizard } = await import("../wizard.js");
		const wizard = createClackWizard();
		await expect(wizard.selectFramework("node")).resolves.toBe("express");
		expect(selectMock).toHaveBeenCalledWith(expect.objectContaining({ initialValue: "node" }));
	});
});

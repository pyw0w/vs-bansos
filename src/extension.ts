// vs-bansos — free models for the VS Code / Copilot Chat model picker.
import * as vscode from "vscode";
import { BansosChatModelProvider, resetRateLimits } from "./provider";
import { initCatalogCache } from "./health";
import {
	initRelayState,
	relayState,
	saveRelayState,
	setRelay,
	removeRelay,
	deployVercelRelay,
	showRelayStatus,
} from "./relay";

const VENDOR = "bansos";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initRelayState(context.globalStorageUri.fsPath);
	initCatalogCache(context.globalStorageUri.fsPath);

	const provider = new BansosChatModelProvider();
	context.subscriptions.push(
		vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
	);

	// Status bar: relay state at a glance.
	const status = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	status.command = "bansos.manage";
	const updateStatus = () => {
		if (!relayState.statusBarVisible) {
			status.hide();
			return;
		}
		status.text = relayState.enabled
			? "$(sparkle) bansos: relay ON"
			: "$(sparkle) bansos: free models";
		status.tooltip = showRelayStatus();
		status.show();
	};
	const persistRelayChange = (): boolean => {
		if (saveRelayState()) return true;
		updateStatus();
		vscode.window.showErrorMessage(
			"BANSOS: could not save relay settings; the change was reverted.",
		);
		return false;
	};
	updateStatus();
	context.subscriptions.push(status);

	// Kick off the health check so the picker is populated ASAP.
	provider.refresh()
		.then((models) => {
			updateStatus();
			if (models.length) {
				console.log(`[bansos] ${models.length} free models ready`);
			}
		})
		.catch(() => {});

	// ── Command: refresh model list ────────────────────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand("bansos.refreshModels", async () => {
			const pick = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "BANSOS: checking free model catalogs…",
				},
				() => provider.refresh(),
			);
			void pick;
			const info = await provider.provideLanguageModelChatInformation(
				{ silent: true },
				new vscode.CancellationTokenSource().token,
			);
			vscode.window.showInformationMessage(
				`BANSOS: ${info.length} free models available in the chat model picker`,
			);
		}),
	);

	// ── Command: manage (relay menu, mirrored from pi-bansos /bansos) ──
	context.subscriptions.push(
		vscode.commands.registerCommand("bansos.manage", async () => {
			const items: (vscode.QuickPickItem & { action: string })[] = [
				{
					label: `$(sync) Relay: ${relayState.enabled ? "ON → " + relayState.url : "OFF (direct)"}`,
					description: `hits=${relayState.hits} · saved=${relayState.relays.length}`,
					action: "status",
				},
				{
					label: relayState.enabled ? "$(circle-slash) Turn relay OFF" : "$(check) Turn relay ON",
					action: relayState.enabled ? "off" : "on",
				},
				{
					label: "$(list) Switch relay…",
					description: `${relayState.relays.length} saved`,
					action: "switch",
				},
				{
					label: "$(plug) Set relay URL…",
					action: "url",
				},
				{
					label: "$(cloud-upload) Deploy fresh Vercel relay…",
					action: "deploy",
				},
				{
					label: "$(trash) Remove relay…",
					action: "remove",
				},
				{
					label: "$(refresh) Refresh free model list",
					action: "refresh",
				},
				{
					label: relayState.statusBarVisible
						? "$(eye-closed) Hide status bar item"
						: "$(eye) Show status bar item",
					action: "toggleStatusBar",
				},
			];
			const pick = await vscode.window.showQuickPick(items, {
					title: "BANSOS",
			});
			if (!pick) return;

			switch (pick.action) {
				case "on": {
					if (!relayState.url) {
						vscode.window.showWarningMessage(
							"BANSOS: no relay URL saved — set one first (or deploy).",
						);
						return;
					}
					setRelay(true, relayState.url);
					if (!persistRelayChange()) return;
					updateStatus();
					vscode.window.showInformationMessage(showRelayStatus());
					break;
				}
				case "off": {
					setRelay(false, relayState.url);
					if (!persistRelayChange()) return;
					updateStatus();
					vscode.window.showInformationMessage(showRelayStatus());
					break;
				}
				case "status": {
					vscode.window.showInformationMessage(showRelayStatus());
					break;
				}
				case "switch": {
					if (!relayState.relays.length) {
						vscode.window.showWarningMessage("BANSOS: no saved relays");
						return;
					}
					const relays = relayState.relays.map((r) => ({
						label:
							(r.url === relayState.url ? "$(star) " : "$(circle-large-outline) ") +
							r.url,
						description: r.label ?? "",
						url: r.url,
					}));
					const rp = await vscode.window.showQuickPick(relays, {
						title: "Switch relay",
					});
					if (!rp) return;
					setRelay(true, rp.url);
					if (!persistRelayChange()) return;
					updateStatus();
					vscode.window.showInformationMessage(showRelayStatus());
					break;
				}
				case "url": {
					const url = await vscode.window.showInputBox({
						prompt: "Relay URL",
						value: relayState.url,
					});
					if (url === undefined) return;
					setRelay(relayState.enabled, url, "manual");
					if (!persistRelayChange()) return;
					updateStatus();
					vscode.window.showInformationMessage(showRelayStatus());
					break;
				}
				case "remove": {
					const removable = relayState.relays.filter(
						(r) => r.url !== relayState.url,
					);
					if (!removable.length) {
						vscode.window.showWarningMessage(
							"BANSOS: nothing to remove (active relay can't be removed — switch first)",
						);
						return;
					}
					const rp = await vscode.window.showQuickPick(
						removable.map((r) => ({
							label: r.url,
							description: r.label ?? "",
							url: r.url,
						})),
						{ title: "Remove relay" },
					);
					if (!rp) return;
					removeRelay(rp.url);
					if (!persistRelayChange()) return;
					vscode.window.showInformationMessage(`BANSOS: removed ${rp.url}`);
					break;
				}
				case "deploy": {
					const token = await vscode.window.showInputBox({
						prompt: "Vercel API token (vercel-…, used once, never stored)",
					});
					if (!token) return;
					const defName = `relay-${Date.now().toString(36)}`;
					const name =
						(await vscode.window.showInputBox({
							prompt: "Project name (empty = auto)",
							value: defName,
						})) || defName;
					try {
						const url = await vscode.window.withProgress(
							{
								location: vscode.ProgressLocation.Notification,
								title: `BANSOS: deploying relay "${name}"…`,
							},
							() => deployVercelRelay(token, name),
						);
						setRelay(true, url, `deployed ${name}`);
						if (!persistRelayChange()) {
							vscode.window.showWarningMessage(
								`BANSOS: relay deployed at ${url}, but settings were not saved. Set this URL manually to use it.`,
							);
							return;
						}
						updateStatus();
						vscode.window.showInformationMessage(
							`BANSOS: deployed & active — ${url}`,
						);
					} catch (e) {
						vscode.window.showErrorMessage(
							`BANSOS: deploy failed — ${(e as Error).message}`,
						);
					}
					break;
				}
				case "refresh": {
					await provider.refresh();
					vscode.window.showInformationMessage("BANSOS: model list refreshed");
					break;
				}
				case "toggleStatusBar": {
					relayState.statusBarVisible = !relayState.statusBarVisible;
					if (!persistRelayChange()) return;
					updateStatus();
					vscode.window.showInformationMessage(
						`BANSOS status bar item ${relayState.statusBarVisible ? "shown" : "hidden"}`,
					);
					break;
				}
			}
		}),
	);
}

export function deactivate(): void {
	resetRateLimits();
}

import type { ExtensionAPI, ExtensionContext, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { parseThinkingMode, summarizeThinkingText } from "./parse.js";
import { clearThinkingStepsModePreference, readThinkingStepsModePreference, writeThinkingStepsModePreference } from "./persistence.js";
import { renderThinkingMarkdown } from "./render.js";
import { getCurrentThinkingScopeKey, getCurrentTheme, getThinkingStepsMode, nextThinkingRefreshLabel, setCurrentTheme, setCurrentThinkingScopeKey, setThinkingStepsMode } from "./state.js";
import type { PersistedThinkingStepsPreferenceScope, ThinkingStepsMode } from "./types.js";

type ThinkingStepsCommandScope = "session" | PersistedThinkingStepsPreferenceScope;
type ThinkingStepsCommandAction =
	| { type: "set"; scope: ThinkingStepsCommandScope; mode?: ThinkingStepsMode }
	| { type: "clear"; scope: PersistedThinkingStepsPreferenceScope };

const CUSTOM_ENTRY_TYPE = "thinking-steps.mode";
const DEFAULT_MODE: ThinkingStepsMode = "summary";
const DEFAULT_HIDDEN_LABEL = "Thinking...";
const MODE_OPTIONS: ThinkingStepsMode[] = ["collapsed", "summary", "expanded"];
const SCOPE_OPTIONS: PersistedThinkingStepsPreferenceScope[] = ["project", "global"];

function collapsedPreviewFromText(text: string): string | undefined {
	const summary = summarizeThinkingText(text);
	const normalized = summary.replace(/\s+/g, " ").trim();
	if (!normalized || normalized === "Reasoning is hidden by the provider.") return undefined;
	return normalized.length > 72 ? `${normalized.slice(0, 71)}…` : normalized;
}

function modeStatusText(ctx: ExtensionContext, mode: ThinkingStepsMode): string {
	return `${ctx.ui.theme.fg("muted", "thinking:")} ${ctx.ui.theme.fg("accent", mode)}`;
}

function modeChangeMessage(mode: ThinkingStepsMode, scope: ThinkingStepsCommandScope): string {
	if (scope === "session") {
		return `Thinking view: ${mode}`;
	}

	return `Thinking view: ${mode} (saved for ${scope})`;
}

function invalidUsageMessage(): string {
	return "Usage: /thinking-steps [collapsed|summary|expanded] | [project|global] [collapsed|summary|expanded|clear]";
}

function notifyUser(ctx: ExtensionContext, message: string, level: "info" | "warning"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}

	if (level === "warning") {
		console.warn(message);
		return;
	}

	console.info(message);
}

function persistMode(pi: ExtensionAPI, mode: ThinkingStepsMode): void {
	pi.appendEntry(CUSTOM_ENTRY_TYPE, { mode });
}

async function readRestoredModePreference(
	ctx: ExtensionContext,
	scope: PersistedThinkingStepsPreferenceScope,
): Promise<ThinkingStepsMode | undefined> {
	try {
		return await readThinkingStepsModePreference(scope, ctx.cwd);
	} catch (error) {
		notifyUser(ctx, `Thinking steps persistence error: ${error instanceof Error ? error.message : String(error)}`, "warning");
		return undefined;
	}
}

async function restoreMode(ctx: ExtensionContext): Promise<ThinkingStepsMode> {
	const entries = ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: { mode?: string } }>;
	const savedEntries = entries.filter((entry) => entry.type === "custom" && entry.customType === CUSTOM_ENTRY_TYPE);
	for (let index = savedEntries.length - 1; index >= 0; index -= 1) {
		const sessionMode = parseThinkingMode(savedEntries[index]?.data?.mode ?? "");
		if (sessionMode) return sessionMode;
	}

	const projectMode = await readRestoredModePreference(ctx, "project");
	if (projectMode) return projectMode;

	const globalMode = await readRestoredModePreference(ctx, "global");
	return globalMode ?? DEFAULT_MODE;
}

function refreshThinkingUI(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	setCurrentTheme(ctx.ui.theme);
	setCurrentThinkingScopeKey(ctx.cwd);
	ctx.ui.setStatus("thinking-steps", modeStatusText(ctx, getThinkingStepsMode(ctx.cwd)));
	setCurrentThinkingScopeKey(ctx.cwd);
	ctx.ui.setHiddenThinkingLabel(nextThinkingRefreshLabel(DEFAULT_HIDDEN_LABEL, ctx.cwd));
}

function applyMode(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	mode: ThinkingStepsMode,
	options?: { persistSession?: boolean; announceScope?: ThinkingStepsCommandScope },
): void {
	setCurrentThinkingScopeKey(ctx.cwd);
	setThinkingStepsMode(mode, ctx.cwd);
	if (options?.persistSession !== false) {
		persistMode(pi, mode);
	}
	refreshThinkingUI(ctx);
	if (options?.announceScope) {
		notifyUser(ctx, modeChangeMessage(mode, options.announceScope), "info");
	}
}

function cycleMode(current: ThinkingStepsMode): ThinkingStepsMode {
	if (current === "collapsed") return "summary";
	if (current === "summary") return "expanded";
	return "collapsed";
}

function parsePreferenceScope(input: string): PersistedThinkingStepsPreferenceScope | undefined {
	const normalized = input.trim().toLowerCase();
	if (["project", "proj", "p"].includes(normalized)) return "project";
	if (["global", "user", "g"].includes(normalized)) return "global";
	return undefined;
}

function isClearCommand(input: string): boolean {
	return ["clear", "reset"].includes(input.trim().toLowerCase());
}

function parseCommandAction(args: string): ThinkingStepsCommandAction | undefined {
	const trimmed = args.trim();
	if (!trimmed) {
		return { type: "set", scope: "session" };
	}

	const scope = parsePreferenceScope(trimmed.split(/\s+/, 1)[0] ?? "");
	if (!scope) {
		const mode = parseThinkingMode(trimmed);
		return mode ? { type: "set", scope: "session", mode } : undefined;
	}

	const tail = trimmed.replace(/^\S+\s*/, "");
	if (!tail) {
		return { type: "set", scope };
	}

	if (isClearCommand(tail)) {
		return { type: "clear", scope };
	}

	const mode = parseThinkingMode(tail);
	return mode ? { type: "set", scope, mode } : undefined;
}

function buildCompletionItems(values: string[], prefix: string, prefixText = ""): AutocompleteItem[] | null {
	const normalizedPrefix = prefix.trim().toLowerCase();
	const items = values
		.filter((value) => value.startsWith(normalizedPrefix))
		.map((value) => ({ value: `${prefixText}${value}`, label: value }));
	return items.length > 0 ? items : null;
}

function thinkingModeCompletions(prefix: string): AutocompleteItem[] | null {
	const trimmed = prefix.trim();
	const endsWithWhitespace = /\s$/.test(prefix);

	if (!trimmed) {
		return [
			...MODE_OPTIONS.map((value) => ({ value, label: value })),
			...SCOPE_OPTIONS.map((value) => ({ value, label: value })),
		];
	}

	const parts = trimmed.split(/\s+/);
	if (parts.length === 1 && !endsWithWhitespace) {
		return buildCompletionItems([...MODE_OPTIONS, ...SCOPE_OPTIONS], parts[0] ?? "");
	}

	const scope = parsePreferenceScope(parts[0] ?? "");
	if (!scope) {
		return null;
	}

	const valuePrefix = `${scope} `;
	const nestedPrefix = endsWithWhitespace ? "" : parts.slice(1).join(" ");
	return buildCompletionItems([...MODE_OPTIONS, "clear"], nestedPrefix, valuePrefix);
}

async function selectMode(ctx: ExtensionContext): Promise<ThinkingStepsMode | undefined> {
	if (!ctx.hasUI) {
		return undefined;
	}

	const choice = await ctx.ui.select("Thinking view", MODE_OPTIONS);
	return choice ? parseThinkingMode(choice) : undefined;
}

export default function thinkingStepsExtension(pi: ExtensionAPI): void {
	const markdownTransformer: MarkdownTransformer = (markdown, { messageType, isStreaming, availableWidth }) => {
		if (messageType !== "assistant-thinking") return markdown;
		if (!markdown.trim()) return markdown;
		const mode = getThinkingStepsMode(getCurrentThinkingScopeKey());
		return renderThinkingMarkdown(markdown, mode, availableWidth, isStreaming, getCurrentTheme());
	};
	pi.registerMarkdownTransformer(markdownTransformer);

	pi.registerCommand("thinking-steps", {
		description: "Switch thinking view or set/clear project/global defaults",
		getArgumentCompletions: thinkingModeCompletions,
		handler: async (args, ctx) => {
			const action = parseCommandAction(args);
			if (!action) {
				notifyUser(ctx, invalidUsageMessage(), "warning");
				return;
			}

			if (action.type === "clear") {
				try {
					await clearThinkingStepsModePreference(action.scope, ctx.cwd);
				} catch (error) {
					notifyUser(ctx, `Thinking steps persistence error: ${error instanceof Error ? error.message : String(error)}`, "warning");
					return;
				}

				notifyUser(ctx, `Cleared ${action.scope} thinking view default`, "info");
				return;
			}

			const selectedMode = action.mode ?? (await selectMode(ctx));
			if (!selectedMode) {
				return;
			}

			if (action.scope !== "session") {
				try {
					await writeThinkingStepsModePreference(action.scope, ctx.cwd, selectedMode);
				} catch (error) {
					notifyUser(ctx, `Thinking steps persistence error: ${error instanceof Error ? error.message : String(error)}`, "warning");
					return;
				}
			}

			applyMode(pi, ctx, selectedMode, { announceScope: action.scope });
		},
	});

	pi.registerShortcut("alt+t", {
		description: "Cycle thinking view (collapsed, summary, expanded)",
		handler: async (ctx) => {
			const nextMode = cycleMode(getThinkingStepsMode(ctx.cwd));
			applyMode(pi, ctx, nextMode, { announceScope: "session" });
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			setCurrentTheme(ctx.ui.theme);
		}
		const restoredMode = await restoreMode(ctx);
		applyMode(pi, ctx, restoredMode, { persistSession: false });
	});

	pi.on("message_update", async (event, ctx) => {
		if (getThinkingStepsMode(ctx.cwd) !== "collapsed") return;
		const assistantEvent = event.assistantMessageEvent;
		if (assistantEvent.type !== "thinking_delta" && assistantEvent.type !== "thinking_end") return;
		if (!ctx.hasUI) return;
		if (ctx.ui.theme) {
			setCurrentTheme(ctx.ui.theme);
		}
		const partial = assistantEvent.partial;
		const thinkingBlocks = partial.content
			.filter((content) => content.type === "thinking")
			.map((content) => (content as { thinking?: string }).thinking ?? "")
			.filter((text) => text.trim().length > 0);
		if (thinkingBlocks.length === 0) return;
		const preview = collapsedPreviewFromText(thinkingBlocks.join("\n\n"));
		if (preview) {
			ctx.ui.setHiddenThinkingLabel(nextThinkingRefreshLabel(preview, ctx.cwd));
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("thinking-steps", undefined);
		}
	});
}

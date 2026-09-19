import type { ThinkingStepsMode, ThinkingThemeLike } from "./types.js";

const STATE_KEY = Symbol.for("pi-extensions.thinking-steps.v2.state");

interface ModeByScopeState {
	modeByScope: Record<string, ThinkingStepsMode>;
	currentScopeKey: string;
	refreshToggleByScope: Record<string, boolean>;
	theme?: ThinkingThemeLike;
}

const DEFAULT_SCOPE_KEY = "__default__";
const DEFAULT_MODE: ThinkingStepsMode = "summary";
const LABEL_REFRESH_SUFFIX = "\u2060";

const globalState: ModeByScopeState = (globalThis as Record<PropertyKey, unknown>)[STATE_KEY] as ModeByScopeState | undefined ?? {
	modeByScope: {},
	currentScopeKey: DEFAULT_SCOPE_KEY,
	refreshToggleByScope: {},
};
(globalThis as Record<PropertyKey, unknown>)[STATE_KEY] = globalState;

export function normalizeScopeKey(scopeKey: string | undefined): string {
	return scopeKey && scopeKey.trim().length > 0 ? scopeKey : DEFAULT_SCOPE_KEY;
}

export function getCurrentThinkingScopeKey(): string {
	return globalState.currentScopeKey;
}

export function setCurrentThinkingScopeKey(scopeKey: string | undefined): string {
	globalState.currentScopeKey = normalizeScopeKey(scopeKey);
	return globalState.currentScopeKey;
}

export function getThinkingStepsMode(scopeKey?: string): ThinkingStepsMode {
	return globalState.modeByScope[normalizeScopeKey(scopeKey)] ?? DEFAULT_MODE;
}

export function setThinkingStepsMode(mode: ThinkingStepsMode, scopeKey?: string): void {
	globalState.modeByScope[normalizeScopeKey(scopeKey)] = mode;
}

export function nextThinkingRefreshLabel(label: string, scopeKey?: string): string {
	const normalizedScopeKey = normalizeScopeKey(scopeKey);
	const useInvisibleSuffix = globalState.refreshToggleByScope[normalizedScopeKey] ?? false;
	globalState.refreshToggleByScope[normalizedScopeKey] = !useInvisibleSuffix;
	return useInvisibleSuffix ? `${label}${LABEL_REFRESH_SUFFIX}` : label;
}

export function getCurrentTheme(): ThinkingThemeLike | undefined {
	return globalState.theme;
}

export function setCurrentTheme(theme: ThinkingThemeLike | undefined): void {
	globalState.theme = theme;
}

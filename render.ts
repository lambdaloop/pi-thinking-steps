import { deriveThinkingSteps } from "./parse.js";
import type { DerivedThinkingStep, ThinkingSemanticRole, ThinkingSourceBlock, ThinkingStepsMode, ThinkingThemeLike } from "./types.js";

function sanitizeThinkingText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/\u001b[\]PX^_][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g, "")
		.replace(/[\u0090\u0098\u009d\u009e\u009f][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g, "")
		.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[ -/]*[0-9@-~])/g, "")
		.replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, "");
}

function stripInlineFormattingMarkers(text: string): string {
	return text
		.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/(?<![\w/.-])\*(?!\*)(?=\S)([\s\S]*?\S)(?<!\*)\*(?![\w/.-])/g, "$1")
		.replace(/(?<![\w/.-])_(?!_)(?=\S)([\s\S]*?\S)(?<!_)_(?![\w/.-])/g, "$1");
}

function truncatePlain(text: string, maxLength: number): string {
	if (maxLength <= 0) return "";
	const sanitized = stripInlineFormattingMarkers(sanitizeThinkingText(text)).replace(/\s+/g, " ").trim();
	if (sanitized.length <= maxLength) return sanitized;
	return `${sanitized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function roleColor(role: ThinkingSemanticRole): string {
	switch (role) {
		case "verify":
			return "success";
		case "error":
			return "error";
		case "compare":
			return "warning";
		case "inspect":
		case "search":
			return "mdLink";
		case "write":
		case "plan":
			return "accent";
		default:
			return "muted";
	}
}

function styled(theme: ThinkingThemeLike | undefined, color: string, text: string): string {
	if (!theme || !theme.getFgAnsi) return text;
	return `${theme.getFgAnsi(color)}${text}`;
}

function stepHasEventType(step: DerivedThinkingStep, type: string): boolean {
	return step.summaryEvents?.some((event) => event.type === type) ?? false;
}

function selectSummarySteps(steps: DerivedThinkingStep[]): DerivedThinkingStep[] {
	if (steps.length <= 5) return steps;

	const indexed = steps.map((step, index) => ({ step, index }));
	const selected = new Set<number>();
	let latestFailureIndex = -1;
	let latestSuccessAfterFailureIndex = -1;

	for (let index = 0; index < steps.length; index += 1) {
		const step = steps[index]!;
		if (step.hasExplicitFailure) {
			latestFailureIndex = index;
			latestSuccessAfterFailureIndex = -1;
		}
		if (latestFailureIndex !== -1 && step.hasExplicitSuccess && index > latestFailureIndex) {
			latestSuccessAfterFailureIndex = index;
		}
	}

	if (latestFailureIndex !== -1) selected.add(latestFailureIndex);
	if (latestSuccessAfterFailureIndex !== -1) selected.add(latestSuccessAfterFailureIndex);

	const scoreEntry = ({ step, index }: { step: DerivedThinkingStep; index: number }): number => {
		let score = step.collapsedPriority ?? 0;
		const isStaleSuccessBeforeLatestFailure = step.hasExplicitSuccess && latestFailureIndex !== -1 && index < latestFailureIndex;
		if (index === latestFailureIndex && latestSuccessAfterFailureIndex === -1) score += 120;
		if (index === latestSuccessAfterFailureIndex) score += 110;
		if (stepHasEventType(step, "decision") || stepHasEventType(step, "plan_change")) score += 80;
		if (step.hasExplicitFailure) score += 50;
		if (step.hasExplicitSuccess && !isStaleSuccessBeforeLatestFailure) score += 45;
		if (isStaleSuccessBeforeLatestFailure) score -= 200;
		if (stepHasEventType(step, "focus") && !stepHasEventType(step, "decision") && !stepHasEventType(step, "plan_change") && !step.hasExplicitFailure && !step.hasExplicitSuccess) score -= 15;
		return score + (index / 100);
	};

	const targetCount = Math.min(5, steps.length);
	for (const entry of [...indexed].sort((left, right) => scoreEntry(right) - scoreEntry(left))) {
		if (selected.size >= targetCount) break;
		selected.add(entry.index);
	}

	return [...selected]
		.sort((left, right) => left - right)
		.map((index) => steps[index]!)
		.slice(0, targetCount);
}

function pickCollapsedStep(steps: DerivedThinkingStep[]): DerivedThinkingStep | undefined {
	if (steps.length === 0) return undefined;

	let latestFailureIndex = -1;
	let latestSuccessAfterFailureIndex = -1;

	for (let index = 0; index < steps.length; index += 1) {
		const step = steps[index]!;
		if (step.hasExplicitFailure) {
			latestFailureIndex = index;
			latestSuccessAfterFailureIndex = -1;
		}
		if (latestFailureIndex !== -1 && step.hasExplicitSuccess && index > latestFailureIndex) {
			latestSuccessAfterFailureIndex = index;
		}
	}

	if (latestSuccessAfterFailureIndex !== -1) return steps[latestSuccessAfterFailureIndex];
	if (latestFailureIndex !== -1) return steps[latestFailureIndex];

	return [...steps]
		.sort((left, right) => (right.collapsedPriority ?? 0) - (left.collapsedPriority ?? 0) || right.blockIndex - left.blockIndex || right.stepIndex - left.stepIndex)[0];
}

function renderSummaryMarkdown(steps: DerivedThinkingStep[], availableWidth: number, theme?: ThinkingThemeLike): string {
	const lines = [
		`${styled(theme, "muted", "┆")}${styled(theme, "dim", " Thinking Steps · Summary")}`,
	];
	const visibleSteps = selectSummarySteps(steps);
	for (let index = 0; index < visibleSteps.length; index++) {
		const step = visibleSteps[index]!;
		const connector = index === visibleSteps.length - 1 ? "└─" : "├─";
		const summary = truncatePlain(step.summary, Math.max(12, availableWidth - 10));
		const icon = styled(theme, roleColor(step.role), step.icon);
		const rest = styled(theme, "thinkingText", ` ${summary}`);
		lines.push(`${styled(theme, "muted", connector)} ${icon}${rest}`);
	}
	return lines.join("\n");
}

function renderCollapsedMarkdown(steps: DerivedThinkingStep[], availableWidth: number, isStreaming: boolean, theme?: ThinkingThemeLike): string {
	const step = pickCollapsedStep(steps);
	if (!step) return "";
	const summary = truncatePlain(step.summary, Math.max(12, availableWidth - 16));
	const activity = isStreaming ? " ·" : "";
	const icon = styled(theme, roleColor(step.role), step.icon);
	const rest = styled(theme, "thinkingText", ` ${summary}${activity}`);
	return `${styled(theme, "muted", "│")} ${styled(theme, "dim", "Thinking")} ${icon}${rest}`;
}

function renderExpandedMarkdown(text: string): string {
	return sanitizeThinkingText(text);
}

export function renderThinkingMarkdown(
	text: string,
	mode: ThinkingStepsMode,
	availableWidth: number,
	isStreaming: boolean,
	theme?: ThinkingThemeLike,
): string {
	const sanitized = sanitizeThinkingText(text);
	const blocks: ThinkingSourceBlock[] = [{ contentIndex: 0, text: sanitized }];
	const steps = deriveThinkingSteps(blocks);
	if (steps.length === 0) return sanitized;

	if (mode === "collapsed") {
		return renderCollapsedMarkdown(steps, availableWidth, isStreaming, theme);
	}
	if (mode === "expanded") {
		return renderExpandedMarkdown(sanitized);
	}
	return renderSummaryMarkdown(steps, availableWidth, theme);
}

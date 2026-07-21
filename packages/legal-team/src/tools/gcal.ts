import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { google } from "googleapis";
import { Type } from "typebox";
import type { LegalTeamConfig } from "../config.ts";
import type { ApprovalBroker } from "../orchestrator/approval.ts";
import type { GateContext } from "./gmail.ts";
import { getGoogleAuth, requireScope } from "./google-auth.ts";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: {} };
}

function calendarClient(config: LegalTeamConfig) {
	requireScope(config, CALENDAR_SCOPE);
	return google.calendar({ version: "v3", auth: getGoogleAuth(config) });
}

interface EventProposal {
	proposalId: string;
	summary: string;
	startIso: string;
	endIso: string;
	description?: string;
	location?: string;
	attendees?: string[];
	createdAt: string;
}

function proposalsDir(artifactsDir: string): string {
	const dir = join(artifactsDir, "calendar-proposals");
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Read-only listing tool; safe to hand to monitors on its own. */
export function createCalendarListTool(config: LegalTeamConfig, lookaheadDays = 30): ToolDefinition<any, any> {
	return defineTool({
		name: "calendar_list_events",
		label: "Calendar List Events",
		description: "List events on the primary Google Calendar in a time window (read-only).",
		parameters: Type.Object({
			timeMin: Type.Optional(Type.String({ description: "ISO start of window (default: now)" })),
			timeMax: Type.Optional(Type.String({ description: `ISO end of window (default: +${lookaheadDays}d)` })),
			query: Type.Optional(Type.String({ description: "Free-text search filter" })),
		}),
		execute: async (_id, params) => {
			const calendar = calendarClient(config);
			const timeMin = params.timeMin ?? new Date().toISOString();
			const timeMax = params.timeMax ?? new Date(Date.now() + lookaheadDays * 86_400_000).toISOString();
			const events = await calendar.events.list({
				calendarId: "primary",
				timeMin,
				timeMax,
				q: params.query,
				singleEvents: true,
				orderBy: "startTime",
				maxResults: 100,
			});
			const rows = (events.data.items ?? []).map((e) =>
				[
					`id: ${e.id}`,
					`when: ${e.start?.dateTime ?? e.start?.date} → ${e.end?.dateTime ?? e.end?.date}`,
					`summary: ${e.summary ?? "(no title)"}`,
					e.location ? `location: ${e.location}` : undefined,
				]
					.filter(Boolean)
					.join("\n"),
			);
			return text(rows.length > 0 ? rows.join("\n---\n") : `No events between ${timeMin} and ${timeMax}.`);
		},
	});
}

/**
 * Calendar tools. list + propose are green (read-only / artifact-only);
 * calendar_create_event is a RED gate enforced through the approval broker.
 */
export function createCalendarTools(
	config: LegalTeamConfig,
	broker: ApprovalBroker,
	getContext: () => GateContext,
	getArtifactsDir: () => string,
	lookaheadDays = 30,
): ToolDefinition<any, any>[] {
	const list = createCalendarListTool(config, lookaheadDays);

	const propose = defineTool({
		name: "calendar_propose_event",
		label: "Calendar Propose Event",
		description:
			"Write a calendar event PROPOSAL as a task artifact (no calendar write happens). Proposals are the green-path output; creating the event is a separate hard-gated step.",
		parameters: Type.Object({
			summary: Type.String(),
			startIso: Type.String({ description: "Event start, ISO 8601 with timezone" }),
			endIso: Type.String({ description: "Event end, ISO 8601 with timezone" }),
			description: Type.Optional(Type.String()),
			location: Type.Optional(Type.String()),
			attendees: Type.Optional(Type.Array(Type.String())),
		}),
		execute: async (_id, params) => {
			const dir = proposalsDir(getArtifactsDir());
			const proposalId = `P-${Date.now().toString(36)}`;
			const proposal: EventProposal = { proposalId, createdAt: new Date().toISOString(), ...params };
			writeFileSync(join(dir, `${proposalId}.json`), `${JSON.stringify(proposal, null, "\t")}\n`);
			return text(
				`Proposal ${proposalId} written to ${join(dir, `${proposalId}.json`)}. Creating the event requires calendar_create_event and human approval.`,
			);
		},
	});

	const create = defineTool({
		name: "calendar_create_event",
		label: "Calendar Create Event (hard gate)",
		description:
			"Create an event on the primary Google Calendar from a prior proposal (or inline fields). HARD GATE: the supervising attorney must approve before the calendar is written.",
		parameters: Type.Object({
			proposalId: Type.Optional(Type.String({ description: "Id of a proposal written by calendar_propose_event" })),
			summary: Type.Optional(Type.String()),
			startIso: Type.Optional(Type.String()),
			endIso: Type.Optional(Type.String()),
			description: Type.Optional(Type.String()),
			location: Type.Optional(Type.String()),
			attendees: Type.Optional(Type.Array(Type.String())),
		}),
		execute: async (_id, params) => {
			let event: Omit<EventProposal, "proposalId" | "createdAt">;
			if (params.proposalId) {
				const path = join(proposalsDir(getArtifactsDir()), `${params.proposalId}.json`);
				event = JSON.parse(readFileSync(path, "utf-8")) as EventProposal;
			} else if (params.summary && params.startIso && params.endIso) {
				event = {
					summary: params.summary,
					startIso: params.startIso,
					endIso: params.endIso,
					description: params.description,
					location: params.location,
					attendees: params.attendees,
				};
			} else {
				throw new Error("Provide either proposalId or summary+startIso+endIso.");
			}
			const ctx = getContext();
			const decision = await broker.request(
				{
					matter: ctx.matter,
					taskId: ctx.taskId,
					agent: ctx.agent,
					gate: "calendar_create_event",
					description: `Create calendar event "${event.summary}"`,
					payloadPreview: [
						`Summary:  ${event.summary}`,
						`When:     ${event.startIso} → ${event.endIso}`,
						event.location ? `Location: ${event.location}` : undefined,
						event.attendees?.length ? `Invitees: ${event.attendees.join(", ")}` : undefined,
						event.description ? `Notes:    ${event.description}` : undefined,
					]
						.filter((l): l is string => l !== undefined)
						.join("\n"),
				},
				ctx.msc,
			);
			if (!decision.approved) {
				return text(
					`CALENDAR WRITE BLOCKED by ${decision.decidedBy}: no event was created.` +
						(decision.note ? ` Note: ${decision.note}` : "") +
						" Keep the proposal artifact and report this outcome.",
				);
			}
			const calendar = calendarClient(config);
			const created = await calendar.events.insert({
				calendarId: "primary",
				requestBody: {
					summary: event.summary,
					description: event.description,
					location: event.location,
					start: { dateTime: event.startIso },
					end: { dateTime: event.endIso },
					attendees: event.attendees?.map((email) => ({ email })),
				},
			});
			return text(`Event created (approved by human): ${created.data.htmlLink ?? created.data.id}`);
		},
	});

	return [list, propose, create];
}

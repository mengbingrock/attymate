import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { google } from "googleapis";
import { Type } from "typebox";
import type { LegalTeamConfig } from "../config.ts";
import type { ApprovalBroker } from "../orchestrator/approval.ts";
import type { MatterSafetyContract } from "../orchestrator/msc.ts";
import { getGoogleAuth } from "./google-auth.ts";

/** Ambient task identity used when a tool crosses a hard gate. */
export interface GateContext {
	matter: string;
	taskId: string;
	agent: string;
	msc: MatterSafetyContract;
}

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: {} };
}

function gmailClient(config: LegalTeamConfig) {
	return google.gmail({ version: "v1", auth: getGoogleAuth(config) });
}

function headerValue(
	headers: Array<{ name?: string | null; value?: string | null }> | undefined,
	name: string,
): string {
	return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function createGmailReadTools(config: LegalTeamConfig, maxResultsCap = 25): ToolDefinition<any, any>[] {
	const gmailSearch = defineTool({
		name: "gmail_search",
		label: "Gmail Search",
		description:
			"Search the firm mailbox (read-only) with a Gmail query string. Returns message ids, dates, senders, subjects, and snippets. Stay within the approved monitor scope.",
		parameters: Type.Object({
			query: Type.String({ description: "Gmail search query, e.g. `newer_than:2d -category:promotions`" }),
			maxResults: Type.Optional(Type.Number({ description: `Max messages to return (cap ${maxResultsCap})` })),
			labelIds: Type.Optional(Type.Array(Type.String(), { description: "Restrict to these Gmail label ids" })),
		}),
		execute: async (_id, params) => {
			const gmail = gmailClient(config);
			const list = await gmail.users.messages.list({
				userId: "me",
				q: params.query,
				maxResults: Math.min(params.maxResults ?? maxResultsCap, maxResultsCap),
				labelIds: params.labelIds,
			});
			const rows: string[] = [];
			for (const m of list.data.messages ?? []) {
				const msg = await gmail.users.messages.get({
					userId: "me",
					id: m.id ?? "",
					format: "metadata",
					metadataHeaders: ["From", "To", "Subject", "Date", "Message-ID"],
				});
				const headers = msg.data.payload?.headers ?? [];
				rows.push(
					[
						`id: ${m.id}`,
						`date: ${headerValue(headers, "Date")}`,
						`from: ${headerValue(headers, "From")}`,
						`subject: ${headerValue(headers, "Subject")}`,
						`snippet: ${msg.data.snippet ?? ""}`,
					].join("\n"),
				);
			}
			return text(rows.length > 0 ? rows.join("\n---\n") : "No messages matched.");
		},
	});

	const gmailRead = defineTool({
		name: "gmail_read_message",
		label: "Gmail Read Message",
		description: "Read one Gmail message by id (read-only). Set includeBody=false for headers/snippet only.",
		parameters: Type.Object({
			messageId: Type.String({ description: "Gmail message id from gmail_search" }),
			includeBody: Type.Optional(
				Type.Boolean({ description: "Include the decoded plain-text body (default true)" }),
			),
		}),
		execute: async (_id, params) => {
			const gmail = gmailClient(config);
			const msg = await gmail.users.messages.get({ userId: "me", id: params.messageId, format: "full" });
			const headers = msg.data.payload?.headers ?? [];
			const lines = [
				`id: ${msg.data.id}`,
				`threadId: ${msg.data.threadId}`,
				`date: ${headerValue(headers, "Date")}`,
				`from: ${headerValue(headers, "From")}`,
				`to: ${headerValue(headers, "To")}`,
				`subject: ${headerValue(headers, "Subject")}`,
				`message-id: ${headerValue(headers, "Message-ID")}`,
			];
			if (params.includeBody !== false) {
				lines.push(
					"",
					extractPlainText(msg.data.payload) || `(no plain-text body) snippet: ${msg.data.snippet ?? ""}`,
				);
			}
			return text(lines.join("\n"));
		},
	});

	return [gmailSearch, gmailRead];
}

function extractPlainText(
	payload: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: any[] } | undefined | null,
): string {
	if (!payload) return "";
	if (payload.mimeType === "text/plain" && payload.body?.data) {
		return Buffer.from(payload.body.data, "base64url").toString("utf-8");
	}
	for (const part of payload.parts ?? []) {
		const found = extractPlainText(part);
		if (found) return found;
	}
	return "";
}

/**
 * gmail_send is a RED gate: the approval broker is consulted inside the tool,
 * so the model can compose freely but the send itself always passes through
 * visible human approval (or is auto-denied in sandbox mode).
 */
export function createGmailSendTool(
	config: LegalTeamConfig,
	broker: ApprovalBroker,
	getContext: () => GateContext,
): ToolDefinition<any, any> {
	return defineTool({
		name: "gmail_send",
		label: "Gmail Send (hard gate)",
		description:
			"Send an email from the firm mailbox. HARD GATE: the supervising attorney is shown the full email and must approve before anything is sent.",
		parameters: Type.Object({
			to: Type.Array(Type.String(), { description: "Recipient email addresses" }),
			cc: Type.Optional(Type.Array(Type.String())),
			subject: Type.String(),
			bodyText: Type.String({ description: "Plain-text body" }),
			inReplyTo: Type.Optional(
				Type.String({ description: "Message-ID being replied to (sets In-Reply-To/References)" }),
			),
		}),
		execute: async (_id, params) => {
			const ctx = getContext();
			const preview = [
				`To: ${params.to.join(", ")}`,
				params.cc?.length ? `Cc: ${params.cc.join(", ")}` : undefined,
				`Subject: ${params.subject}`,
				"",
				params.bodyText,
			]
				.filter((l): l is string => l !== undefined)
				.join("\n");
			const decision = await broker.request(
				{
					matter: ctx.matter,
					taskId: ctx.taskId,
					agent: ctx.agent,
					gate: "gmail_send",
					description: `Send email to ${params.to.join(", ")}`,
					payloadPreview: preview,
				},
				ctx.msc,
			);
			if (!decision.approved) {
				return text(
					`SEND BLOCKED by ${decision.decidedBy}: the email was NOT sent.` +
						(decision.note ? ` Note from the supervising attorney: ${decision.note}` : "") +
						" Do not retry without new instructions; report this outcome instead.",
				);
			}
			const headers = [
				`To: ${params.to.join(", ")}`,
				params.cc?.length ? `Cc: ${params.cc.join(", ")}` : undefined,
				`Subject: ${params.subject}`,
				params.inReplyTo ? `In-Reply-To: ${params.inReplyTo}` : undefined,
				params.inReplyTo ? `References: ${params.inReplyTo}` : undefined,
				'Content-Type: text/plain; charset="UTF-8"',
			].filter((l): l is string => l !== undefined);
			const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${params.bodyText}`).toString("base64url");
			const gmail = gmailClient(config);
			const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
			return text(`Email sent (approved by human). Gmail message id: ${sent.data.id}`);
		},
	});
}

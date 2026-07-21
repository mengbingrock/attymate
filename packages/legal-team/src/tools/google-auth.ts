import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { google } from "googleapis";
import type { LegalTeamConfig } from "../config.ts";

// Use the OAuth2 client bundled with googleapis so the instance type matches
// what the API clients expect.
const OAuth2Client: typeof google.auth.OAuth2 = google.auth.OAuth2;
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const GOOGLE_SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/calendar",
];

interface StoredToken {
	token?: string;
	refresh_token?: string;
	scopes?: string[];
	expiry?: string;
	client_id?: string;
	client_secret?: string;
	token_uri?: string;
}

function credentialsPath(config: LegalTeamConfig): string {
	return join(config.google.secretsDir, "credentials.json");
}

function tokenPath(config: LegalTeamConfig): string {
	return join(config.google.secretsDir, "token.json");
}

function loadClientSecrets(config: LegalTeamConfig): { clientId: string; clientSecret: string } {
	const path = credentialsPath(config);
	if (!existsSync(path)) {
		throw new Error(
			`Google OAuth client not found at ${path}. Copy gmail-toolkit/credentials.json there ` +
				"(see packages/legal-team/README.md), then run `legal-team auth google`.",
		);
	}
	const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, { client_id: string; client_secret: string }>;
	const entry = raw.installed ?? raw.web;
	if (!entry) throw new Error(`Unrecognized OAuth client format in ${path} (expected "installed" or "web").`);
	return { clientId: entry.client_id, clientSecret: entry.client_secret };
}

/**
 * Persist tokens in the same `authorized_user` JSON shape the python
 * gmail-toolkit writes, so both toolkits can share the token file.
 */
function persistToken(config: LegalTeamConfig, client: OAuth2Client, clientId: string, clientSecret: string): void {
	const c = client.credentials;
	const stored: StoredToken = {
		token: c.access_token ?? undefined,
		refresh_token: c.refresh_token ?? undefined,
		scopes: typeof c.scope === "string" ? c.scope.split(" ") : GOOGLE_SCOPES,
		expiry: c.expiry_date ? new Date(c.expiry_date).toISOString() : undefined,
		client_id: clientId,
		client_secret: clientSecret,
		token_uri: "https://oauth2.googleapis.com/token",
	};
	mkdirSync(config.google.secretsDir, { recursive: true, mode: 0o700 });
	writeFileSync(tokenPath(config), `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
}

export function grantedScopes(config: LegalTeamConfig): string[] {
	try {
		const stored = JSON.parse(readFileSync(tokenPath(config), "utf-8")) as StoredToken;
		return stored.scopes ?? [];
	} catch {
		return [];
	}
}

/**
 * Build an authenticated OAuth2 client from the shared secrets dir. Refreshed
 * access tokens are persisted back automatically.
 */
export function getGoogleAuth(config: LegalTeamConfig): OAuth2Client {
	const { clientId, clientSecret } = loadClientSecrets(config);
	const path = tokenPath(config);
	if (!existsSync(path)) {
		throw new Error(`Google token not found at ${path}. Run \`legal-team auth google\` to grant access.`);
	}
	const stored = JSON.parse(readFileSync(path, "utf-8")) as StoredToken;
	if (!stored.refresh_token) {
		throw new Error(`No refresh token in ${path}. Run \`legal-team auth google\` to re-consent.`);
	}
	const client = new OAuth2Client(clientId, clientSecret);
	client.setCredentials({
		access_token: stored.token,
		refresh_token: stored.refresh_token,
		expiry_date: stored.expiry ? Date.parse(stored.expiry) : undefined,
		scope: stored.scopes?.join(" "),
	});
	client.on("tokens", () => persistToken(config, client, clientId, clientSecret));
	return client;
}

export function requireScope(config: LegalTeamConfig, scope: string): void {
	if (!grantedScopes(config).includes(scope)) {
		throw new Error(
			`Google scope ${scope} has not been granted. Run \`legal-team auth google\` to re-consent with the full scope set.`,
		);
	}
}

/**
 * Interactive loopback consent flow: prints the consent URL, waits for the
 * redirect on 127.0.0.1, exchanges the code, and persists the token.
 */
export async function runGoogleConsentFlow(config: LegalTeamConfig): Promise<string> {
	const { clientId, clientSecret } = loadClientSecrets(config);
	return await new Promise<string>((resolvePromise, rejectPromise) => {
		const server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			const code = url.searchParams.get("code");
			const error = url.searchParams.get("error");
			res.writeHead(200, { "content-type": "text/plain" });
			res.end(
				code ? "Authorization received. You can close this tab." : `Authorization failed: ${error ?? "no code"}`,
			);
			server.close();
			if (!code) {
				rejectPromise(new Error(`Google consent failed: ${error ?? "no authorization code returned"}`));
				return;
			}
			const redirectUri = `http://127.0.0.1:${port}`;
			const client = new OAuth2Client(clientId, clientSecret, redirectUri);
			client
				.getToken(code)
				.then(({ tokens }) => {
					client.setCredentials(tokens);
					persistToken(config, client, clientId, clientSecret);
					resolvePromise(`Google access granted; token stored in ${tokenPath(config)}`);
				})
				.catch(rejectPromise);
		});
		let port = 0;
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				rejectPromise(new Error("Could not open loopback port for Google consent"));
				return;
			}
			port = address.port;
			const redirectUri = `http://127.0.0.1:${port}`;
			const client = new OAuth2Client(clientId, clientSecret, redirectUri);
			const url = client.generateAuthUrl({
				access_type: "offline",
				prompt: "consent",
				scope: GOOGLE_SCOPES,
			});
			process.stdout.write(`\nOpen this URL in a browser to grant Gmail + Calendar access:\n\n${url}\n\n`);
		});
	});
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SECRET_KEY_RE = /(token|key|secret|refresh|access|authorization)/i;
const IDENTITY_KEY_RE = /^(email|mail|username|userName|login|account|accountId|organization|org|team|tenant|subject|sub|id)$/i;

export function resolveAuthAuditPaths(home = os.homedir()) {
  return {
    accounts: path.join(home, "PiSwitch", "accounts.json"),
    config: path.join(home, "PiSwitch", "config.json"),
    piAuth: path.join(home, ".pi", "agent", "auth.json"),
  };
}

function safeString(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (!text || text.length > 160) return undefined;
  return text;
}

function collectIdentityFields(value, prefix = "", depth = 0, rows = []) {
  if (!value || typeof value !== "object" || depth > 3) return rows;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) continue;
    const field = prefix ? `${prefix}.${key}` : key;
    const text = safeString(item);
    if (text && IDENTITY_KEY_RE.test(key)) {
      rows.push({ field, value: text });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      collectIdentityFields(item, field, depth + 1, rows);
    }
  }
  return rows;
}

function pushIdentityField(rows, field, value) {
  const text = safeString(value);
  if (!text || rows.length >= 8) return;
  if (rows.some((item) => item.field === field && item.value === text)) return;
  rows.push({ field, value: text });
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return undefined;
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function collectJwtPayloadIdentityFields(payload, rows) {
  if (!payload || typeof payload !== "object") return;
  pushIdentityField(rows, "oauth.email", payload.email);
  pushIdentityField(rows, "oauth.sub", payload.sub);
  pushIdentityField(rows, "oauth.authProvider", payload.auth_provider);

  const auth = payload["https://api.openai.com/auth"];
  if (!auth || typeof auth !== "object") return;
  pushIdentityField(rows, "oauth.chatgptAccountId", auth.chatgpt_account_id);
  pushIdentityField(rows, "oauth.accountId", auth.account_id);
  pushIdentityField(rows, "oauth.chatgptUserId", auth.chatgpt_user_id);
  pushIdentityField(rows, "oauth.userId", auth.user_id);
}

function collectJwtIdentityFields(value, rows, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4 || rows.length >= 8) return;
  for (const [key, item] of Object.entries(value)) {
    if (rows.length >= 8) return;
    if (SECRET_KEY_RE.test(key) && typeof item === "string") {
      collectJwtPayloadIdentityFields(decodeJwtPayload(item), rows);
    }
    if (item && typeof item === "object") {
      collectJwtIdentityFields(item, rows, depth + 1);
    }
  }
}

function oauthIdentityKey(credential) {
  if (!isOAuthCredential(credential)) return undefined;
  const identity = collectIdentityFields(credential).slice(0, 8);
  collectJwtIdentityFields(credential, identity);
  const priority = [
    "oauth.chatgptAccountId",
    "oauth.accountId",
    "account.id",
    "accountId",
    "oauth.chatgptUserId",
    "oauth.userId",
    "user.id",
    "oauth.sub",
    "sub",
    "subject",
    "oauth.email",
    "user.email",
    "email",
  ];
  for (const field of priority) {
    const match = identity.find((item) => item.field.toLowerCase() === field.toLowerCase());
    if (match) return `${field.toLowerCase()}=${match.value}`;
  }
  return undefined;
}

export function readJson(file) {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function credentialSummary(credential) {
  if (!credential || typeof credential !== "object") return undefined;
  const identity = collectIdentityFields(credential).slice(0, 8);
  collectJwtIdentityFields(credential, identity);
  return {
    type: credential.type,
    fields: Object.keys(credential).filter((key) => !SECRET_KEY_RE.test(key)),
    identity,
    identityKey: oauthIdentityKey(credential),
    hasSecret: Object.keys(credential).some((key) => SECRET_KEY_RE.test(key)),
  };
}

export function isOAuthCredential(credential) {
  return credential?.type === "oauth";
}

export function sameCredential(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function matchingAccount(accounts, providerId, currentCredential) {
  const candidates = accounts.filter((account) => account.providerId === providerId);
  const exact = candidates.find((account) => sameCredential(account.credential, currentCredential));
  if (exact) return { account: exact, match: "exact" };

  if (!isOAuthCredential(currentCredential)) return undefined;
  const currentIdentityKey = oauthIdentityKey(currentCredential);
  const identity = currentIdentityKey
    ? candidates.find((account) => oauthIdentityKey(account.credential) === currentIdentityKey)
    : undefined;
  if (identity) return { account: identity, match: "oauthIdentity" };

  const latestApplied = candidates
    .filter((account) => isOAuthCredential(account.credential) && account.lastAppliedAt)
    .sort((left, right) => String(right.lastAppliedAt).localeCompare(String(left.lastAppliedAt)))[0];
  return latestApplied ? { account: latestApplied, match: "latestAppliedOAuth" } : undefined;
}

export function buildAuthAudit(home = os.homedir()) {
  const paths = resolveAuthAuditPaths(home);
  const accounts = readJson(paths.accounts);
  const config = readJson(paths.config);
  const piAuth = readJson(paths.piAuth);
  const savedAccounts = accounts?.accounts ?? [];

  const matchesByProvider = Object.fromEntries(
    Object.entries(piAuth ?? {}).map(([providerId, credential]) => {
      const match = matchingAccount(savedAccounts, providerId, credential);
      return [
        providerId,
        match
          ? {
              accountId: match.account.id,
              label: match.account.label,
              match: match.match,
            }
          : null,
      ];
    }),
  );

  const accountRows = savedAccounts.map((account) => {
    const active = matchesByProvider[account.providerId]?.accountId === account.id;
    return {
      id: account.id,
      label: account.label,
      providerId: account.providerId,
      kind: account.kind,
      activeInPi: active,
      lastAppliedAt: account.lastAppliedAt,
      credential: credentialSummary(account.credential),
    };
  });

  const configRows = (config?.providers ?? []).map((provider) => ({
    id: provider.id,
    kind: provider.kind,
    name: provider.name,
    providerId: provider.providerId,
    authMode: provider.authMode,
    authAccountId: provider.authAccountId,
  }));

  const piAuthRows = Object.fromEntries(
    Object.entries(piAuth ?? {}).map(([providerId, credential]) => [
      providerId,
      credentialSummary(credential),
    ]),
  );

  return {
    files: {
      accounts: fs.existsSync(paths.accounts),
      config: fs.existsSync(paths.config),
      piAuth: fs.existsSync(paths.piAuth),
    },
    accounts: {
      version: accounts?.version,
      count: accountRows.length,
      rows: accountRows,
    },
    config: {
      schemaVersion: config?.schemaVersion,
      providers: configRows,
    },
    activeMatches: matchesByProvider,
    piAuth: piAuthRows,
  };
}

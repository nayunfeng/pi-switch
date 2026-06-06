import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveAuthAuditPaths(home = os.homedir()) {
  return {
    accounts: path.join(home, "PiSwitch", "accounts.json"),
    config: path.join(home, "PiSwitch", "config.json"),
    piAuth: path.join(home, ".pi", "agent", "auth.json"),
  };
}

export function readJson(file) {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function credentialSummary(credential) {
  if (!credential || typeof credential !== "object") return undefined;
  return {
    type: credential.type,
    fields: Object.keys(credential).filter((key) => !/(token|key|secret|refresh|access|authorization)/i.test(key)),
    hasSecret: Object.keys(credential).some((key) => /(token|key|secret|refresh|access|authorization)/i.test(key)),
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

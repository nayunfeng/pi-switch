import { buildAuthAudit } from "./auth-audit-lib.mjs";
import { pathToFileURL } from "node:url";

export function buildCodexAccountsVerification(audit) {
  const codexAccounts = audit.accounts.rows.filter((account) => account.providerId === "openai-codex");
  const codexOAuthAccounts = codexAccounts.filter((account) => account.kind === "oauth");
  const appliedCodexOAuthAccounts = codexOAuthAccounts.filter((account) => account.lastAppliedAt);
  const codexOAuthIdentityKeys = new Set(
    codexOAuthAccounts
      .map((account) => account.credential?.identityKey)
      .filter(Boolean),
  );
  const appliedCodexOAuthIdentityKeys = new Set(
    appliedCodexOAuthAccounts
      .map((account) => account.credential?.identityKey)
      .filter(Boolean),
  );
  const activeMatch = audit.activeMatches["openai-codex"];
  const failures = [];

  if (!audit.files.accounts) {
    failures.push("missing ~/PiSwitch/accounts.json");
  }
  if (!audit.files.piAuth) {
    failures.push("missing ~/.pi/agent/auth.json");
  }
  if (codexOAuthAccounts.length < 2) {
    failures.push(`expected at least 2 openai-codex OAuth accounts, found ${codexOAuthAccounts.length}`);
  }
  if (appliedCodexOAuthAccounts.length < 2) {
    failures.push(`expected at least 2 openai-codex OAuth accounts to have been applied, found ${appliedCodexOAuthAccounts.length}`);
  }
  if (codexOAuthAccounts.length >= 2 && codexOAuthIdentityKeys.size < 2) {
    failures.push(`expected at least 2 distinct openai-codex OAuth identities, found ${codexOAuthIdentityKeys.size}`);
  }
  if (appliedCodexOAuthAccounts.length >= 2 && appliedCodexOAuthIdentityKeys.size < 2) {
    failures.push(`expected at least 2 distinct applied openai-codex OAuth identities, found ${appliedCodexOAuthIdentityKeys.size}`);
  }
  if (!audit.piAuth["openai-codex"]) {
    failures.push("missing openai-codex entry in Pi auth.json");
  }
  if (!activeMatch?.accountId) {
    failures.push("current openai-codex Pi auth does not match a saved account");
  }
  if (activeMatch?.match === "latestAppliedOAuth") {
    failures.push("current openai-codex Pi auth only matched the latest applied OAuth account; expected exact or OAuth identity match");
  }
  if (activeMatch?.accountId && !codexOAuthAccounts.some((account) => account.id === activeMatch.accountId)) {
    failures.push(`active openai-codex account ${activeMatch.accountId} is not a saved OAuth account`);
  }

  return {
    ok: failures.length === 0,
    codexOAuthAccountCount: codexOAuthAccounts.length,
    appliedCodexOAuthAccountCount: appliedCodexOAuthAccounts.length,
    codexOAuthIdentityCount: codexOAuthIdentityKeys.size,
    appliedCodexOAuthIdentityCount: appliedCodexOAuthIdentityKeys.size,
    activeOpenAICodexAccount: activeMatch ?? null,
    accounts: codexOAuthAccounts.map((account) => ({
      id: account.id,
      label: account.label,
      activeInPi: account.activeInPi,
      lastAppliedAt: account.lastAppliedAt,
      credential: account.credential,
    })),
    failures,
  };
}

function main() {
  const summary = buildCodexAccountsVerification(buildAuthAudit());
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failures.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

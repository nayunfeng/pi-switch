import { buildAuthAudit } from "./auth-audit-lib.mjs";

const audit = buildAuthAudit();
const codexAccounts = audit.accounts.rows.filter((account) => account.providerId === "openai-codex");
const codexOAuthAccounts = codexAccounts.filter((account) => account.kind === "oauth");
const appliedCodexOAuthAccounts = codexOAuthAccounts.filter((account) => account.lastAppliedAt);
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
if (!audit.piAuth["openai-codex"]) {
  failures.push("missing openai-codex entry in Pi auth.json");
}
if (!activeMatch?.accountId) {
  failures.push("current openai-codex Pi auth does not match a saved account");
}
if (activeMatch?.accountId && !codexOAuthAccounts.some((account) => account.id === activeMatch.accountId)) {
  failures.push(`active openai-codex account ${activeMatch.accountId} is not a saved OAuth account`);
}

const summary = {
  ok: failures.length === 0,
  codexOAuthAccountCount: codexOAuthAccounts.length,
  appliedCodexOAuthAccountCount: appliedCodexOAuthAccounts.length,
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

console.log(JSON.stringify(summary, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import test from "node:test";

import { credentialSummary, matchingAccount } from "./auth-audit-lib.mjs";
import { buildCodexAccountsVerification } from "./verify-codex-accounts.mjs";

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function codexOAuthAccount(id, identity, lastAppliedAt = "100") {
  return {
    id,
    label: id,
    providerId: "openai-codex",
    kind: "oauth",
    lastAppliedAt,
    credential: {
      type: "oauth",
      tokens: {
        id_token: jwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: identity,
          },
        }),
      },
      refreshToken: `refresh-${id}`,
    },
  };
}

function auditWithCodexAccounts(accounts, activeMatch) {
  return {
    files: {
      accounts: true,
      config: true,
      piAuth: true,
    },
    accounts: {
      rows: accounts.map((account) => ({
        ...account,
        credential: credentialSummary(account.credential),
      })),
    },
    activeMatches: {
      "openai-codex": activeMatch,
    },
    piAuth: {
      "openai-codex": credentialSummary(accounts[0].credential),
    },
  };
}

test("matchingAccount prefers OAuth identity over latest applied fallback", () => {
  const accountA = codexOAuthAccount("codex_a", "acct-a", "100");
  const accountB = codexOAuthAccount("codex_b", "acct-b", "200");
  const currentCredential = {
    type: "oauth",
    tokens: {
      id_token: jwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct-a",
        },
      }),
    },
    refreshToken: "refresh-a-new",
  };

  const match = matchingAccount([accountA, accountB], "openai-codex", currentCredential);

  assert.equal(match.account.id, "codex_a");
  assert.equal(match.match, "oauthIdentity");
});

test("Codex verification rejects latest applied fallback as weak active evidence", () => {
  const accounts = [
    codexOAuthAccount("codex_a", "acct-a", "100"),
    codexOAuthAccount("codex_b", "acct-b", "200"),
  ];
  const summary = buildCodexAccountsVerification(
    auditWithCodexAccounts(accounts, {
      accountId: "codex_b",
      label: "codex_b",
      match: "latestAppliedOAuth",
    }),
  );

  assert.equal(summary.ok, false);
  assert(summary.failures.some((failure) => failure.includes("only matched the latest applied OAuth account")));
});

test("Codex verification requires applied accounts to cover two distinct identities", () => {
  const accounts = [
    codexOAuthAccount("codex_a", "acct-a", "100"),
    codexOAuthAccount("codex_b", "acct-a", "200"),
  ];
  const summary = buildCodexAccountsVerification(
    auditWithCodexAccounts(accounts, {
      accountId: "codex_a",
      label: "codex_a",
      match: "oauthIdentity",
    }),
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.appliedCodexOAuthIdentityCount, 1);
  assert(summary.failures.some((failure) => failure.includes("distinct applied openai-codex OAuth identities")));
});

test("Codex verification accepts two applied distinct identities with strong active match", () => {
  const accounts = [
    codexOAuthAccount("codex_a", "acct-a", "100"),
    codexOAuthAccount("codex_b", "acct-b", "200"),
  ];
  const summary = buildCodexAccountsVerification(
    auditWithCodexAccounts(accounts, {
      accountId: "codex_a",
      label: "codex_a",
      match: "oauthIdentity",
    }),
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.codexOAuthIdentityCount, 2);
  assert.equal(summary.appliedCodexOAuthIdentityCount, 2);
});

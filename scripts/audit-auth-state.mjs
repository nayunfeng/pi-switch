import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const paths = {
  accounts: path.join(home, "PiSwitch", "accounts.json"),
  config: path.join(home, "PiSwitch", "config.json"),
  piAuth: path.join(home, ".pi", "agent", "auth.json"),
};

function readJson(file) {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function credentialSummary(credential) {
  if (!credential || typeof credential !== "object") return undefined;
  return {
    type: credential.type,
    fields: Object.keys(credential).filter((key) => !/(token|key|secret|refresh|access|authorization)/i.test(key)),
    hasSecret: Object.keys(credential).some((key) => /(token|key|secret|refresh|access|authorization)/i.test(key)),
  };
}

const accounts = readJson(paths.accounts);
const config = readJson(paths.config);
const piAuth = readJson(paths.piAuth);

const accountRows = (accounts?.accounts ?? []).map((account) => ({
  id: account.id,
  label: account.label,
  providerId: account.providerId,
  kind: account.kind,
  lastAppliedAt: account.lastAppliedAt,
  credential: credentialSummary(account.credential),
}));

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

console.log(JSON.stringify({
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
  piAuth: piAuthRows,
}, null, 2));

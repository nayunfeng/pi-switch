import { buildAuthAudit } from "./auth-audit-lib.mjs";

console.log(JSON.stringify(buildAuthAudit(), null, 2));

// Scans git-tracked files for committed secrets. Values are masked in output.
// Run: node scripts/scan-secrets.js
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PLACEHOLDER =
  /^(your|changeme|placeholder|example|xxx+|abc123|sk_test|pk_test|whsec_test|process\.env|\$\{|<|todo|fixme)/i;
const BINARY = /\.(png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|pdf|zip|mp4|mov|dll|node)$/i;
const RULES = [
  // Classic Google API key: AIza + 35 chars.
  { name: "google api key (AIza)", re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  // Current Gemini / Google key format: short prefix, dot, long body, optional --sig.
  { name: "google/gemini key (A...--)", re: /\bA[0-9A-Za-z]{1,4}\.[0-9A-Za-z_-]{20,}(?:--[0-9A-Za-z_-]+)?\b/g },
  { name: "aws access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "stripe live secret", re: /\bsk_live_[0-9a-zA-Z]{16,}/g },
  { name: "supabase service key", re: /\beyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}\b/g },
  { name: "supabase anon jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/g },
  { name: "github token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "hardcoded password", re: /\b(?:password|passwd|pwd)\s*[:=]\s*["'][^"'\s]{8,}["']/gi },
];

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const findings = [];

for (const f of files) {
  if (BINARY.test(f) || !fs.existsSync(f)) continue;
  let text;
  try {
    text = fs.readFileSync(path.resolve(f), "utf8");
  } catch {
    continue;
  }
  if (text.includes("�")) continue; // skip binary-ish blobs
  const lines = text.split(/\r?\n/);
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const val = m[0];
      if (PLACEHOLDER.test(val)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      const masked = `${val.slice(0, 6)}...${val.slice(-4)}`;
      findings.push({ file: f, line, rule: rule.name, masked });
    }
  }
  // Dedupe identical (file, rule, masked) hits that repeat on the same line set.
  void lines;
}

const seen = new Set();
const unique = findings.filter((x) => {
  const k = `${x.file}|${x.rule}|${x.masked}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

if (unique.length === 0) {
  console.log("No secrets detected in tracked files.");
} else {
  console.log(`${unique.length} potential secret(s) in git-tracked files:\n`);
  for (const f of unique) {
    console.log(`  ${f.file}:${f.line}  [${f.rule}]  ${f.masked}`);
  }
  console.log("\nTreat every hit as compromised: rotate the credential, then purge it from history.");
}
process.exit(unique.length === 0 ? 0 : 1);

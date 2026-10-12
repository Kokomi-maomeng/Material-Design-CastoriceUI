import { execFileSync } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export const forbiddenNames = /(^|\/)(\.env(?:\..+)?|.*\.(?:key|pem|p12|pfx)|.*(?:credential|secret|password).*)$/i;
export const hasSensitivePath = (filename) => filename.split("/").some((part) => forbiddenNames.test(part));
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  new RegExp("-----BEGIN " + "CERTIFICATE-----"),
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password|passwd)\s*[:=]\s*["'][^"']{8,}["']/i,
];
const emailPattern = /[A-Za-z0-9._%+\-[\]]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const isNoreply = (email) => /^(?:[A-Za-z0-9._+\-[\]]+@users\.noreply\.github\.com|noreply@github\.com)$/i.test(email);
const isExampleEmail = (email) => /@(?:example\.(?:com|net|org)|(?:[A-Za-z0-9-]+\.)*(?:test|invalid))$/i.test(email);
// This is a public service identity, allowed only in content/co-author trailers.
const isPublicCoauthor = (email) => isNoreply(email) || /^copilot@github\.com$/i.test(email);
const isPublicContact = (email) => isPublicCoauthor(email) || /^support@github\.com$/i.test(email);

export function git(root, args, options = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...options });
}

export async function loadPrivateValues(root) {
  let configured;
  try { configured = git(root, ["config", "--get", "castoriceui.privateValuesFile"]).trim(); }
  catch (error) { if (error.status === 1) return []; throw new Error("Cannot read local privacy policy"); }
  try {
    const [directory, filename] = await Promise.all([realpath(root), realpath(path.resolve(root, configured))]);
    const relative = path.relative(directory, filename);
    if (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..") throw new Error("Private list inside public repository");
    const values = JSON.parse(await readFile(filename, "utf8"));
    if (!Array.isArray(values) || !values.length || values.some((value) => typeof value !== "string" || value.length < 4)) throw new Error("Invalid private list");
    return values.map((value) => value.toLowerCase());
  } catch {
    throw new Error("Configured private-value list is invalid, missing, or inside the public repository");
  }
}

export function checkPayload(bytes, privateValues = []) {
  let content = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  let textEmailScan = !Buffer.isBuffer(bytes) || isUtf8(bytes);
  if (Buffer.isBuffer(bytes) && bytes[0] === 0xff && bytes[1] === 0xfe) {
    content = bytes.subarray(2).toString("utf16le"); textEmailScan = true;
  } else if (Buffer.isBuffer(bytes) && bytes[0] === 0xfe && bytes[1] === 0xff && bytes.length % 2 === 0) {
    content = Buffer.from(bytes.subarray(2)).swap16().toString("utf16le"); textEmailScan = true;
  }
  const findings = [];
  if (secretPatterns.some((pattern) => pattern.test(content))) findings.push("credential/key pattern");
  if (textEmailScan && [...content.matchAll(emailPattern)].some(([email]) => !isPublicContact(email) && !isExampleEmail(email))) findings.push("non-example personal email");
  if (textEmailScan && [...content.matchAll(/^Co-authored-by:\s*.+ <([^<>]+)>\s*$/gmi)].some(([, email]) => !isPublicCoauthor(email))) findings.push("non-noreply co-author identity");
  if (privateValues.some((value) => content.toLowerCase().includes(value))) findings.push("known private value");
  return findings;
}

export function checkGitIdentityObject(kind, bytes) {
  if (kind !== "commit" && kind !== "tag") return [];
  const header = bytes.toString("utf8").split("\n\n", 1)[0];
  const identities = [...header.matchAll(/^(author|committer|tagger) .+ <([^<>]*)> \d+ [+-]\d{4}$/gm)];
  if (kind === "commit" && (!identities.some(([, role]) => role === "author") || !identities.some(([, role]) => role === "committer"))) return ["unverifiable commit identity"];
  if (kind === "tag" && !identities.some(([, role]) => role === "tagger")) return ["unverifiable tagger identity"];
  return identities.some(([, , email]) => !isNoreply(email)) ? ["non-noreply Git identity"] : [];
}

export function readGitObjects(root, ids) {
  if (!ids.length) return [];
  const batch = git(root, ["cat-file", "--batch"], { input: `${ids.join("\n")}\n`, encoding: null });
  let offset = 0;
  return ids.map(() => {
    const end = batch.indexOf(10, offset);
    if (end < 0) throw new Error("Incomplete Git object inspection");
    const [id, kind, length] = batch.subarray(offset, end).toString().split(" ");
    const size = Number(length);
    if (!Number.isSafeInteger(size) || size < 0 || batch.length < end + size + 2) throw new Error("Unavailable Git object");
    const data = batch.subarray(end + 1, end + 1 + size);
    offset = end + size + 2;
    return { id, kind, data };
  });
}

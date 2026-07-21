#!/usr/bin/env node
// Verifies that overlay JS selector contracts still match packaged HTML templates.
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const templateDir = path.join(rootDir, "src/content/overlay/templates");
const jsRoots = [
  path.join(rootDir, "src/content/overlay"),
  path.join(rootDir, "src/content/calendar-content-entry.js")
];
const manifestPath = path.join(rootDir, "manifest.json");

function toRepoPath(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function walkFiles(entryPath, extension, files = []) {
  const stat = fs.statSync(entryPath);
  if (stat.isFile()) {
    if (entryPath.endsWith(extension)) files.push(entryPath);
    return files;
  }

  for (const child of fs.readdirSync(entryPath)) {
    walkFiles(path.join(entryPath, child), extension, files);
  }
  return files;
}

function listFiles(entryPaths, extension) {
  return entryPaths.flatMap(entryPath => walkFiles(entryPath, extension)).sort();
}

function extractDataCcAttributes(html) {
  const attributes = new Map();
  const regex = /\b(data-cc-[a-z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
  let match;
  while ((match = regex.exec(html))) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!attributes.has(name)) attributes.set(name, new Set());
    attributes.get(name).add(value);
  }
  return attributes;
}

function mergeAttributeMaps(maps) {
  const merged = new Map();
  for (const map of maps) {
    for (const [name, values] of map.entries()) {
      if (!merged.has(name)) merged.set(name, new Set());
      values.forEach(value => merged.get(name).add(value));
    }
  }
  return merged;
}

function extractSelectorContracts(js) {
  const contracts = new Map();
  const regex = /\[\s*(data-cc-[a-z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s"'=]+)))?\s*\]/gi;
  let match;
  while ((match = regex.exec(js))) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? null;
    if (!contracts.has(name)) contracts.set(name, new Set());
    if (value !== null) contracts.get(name).add(value);
  }
  return contracts;
}

function extractTemplatePaths(js) {
  const paths = new Set();
  const regex = /src\/content\/overlay\/templates\/[^"'`\s)]+\.html/g;
  let match;
  while ((match = regex.exec(js))) paths.add(match[0]);
  return paths;
}

function checkTemplateShape(filePath, html, errors) {
  const repoPath = toRepoPath(filePath);
  if (!html.trim()) {
    errors.push(`${repoPath}: template file is empty.`);
  }
  if (/^(<<<<<<<|=======|>>>>>>>) /m.test(html)) {
    errors.push(`${repoPath}: contains merge conflict markers.`);
  }

  const openTemplateTags = html.match(/<template\b/gi)?.length || 0;
  const closeTemplateTags = html.match(/<\/template>/gi)?.length || 0;
  if (openTemplateTags !== closeTemplateTags) {
    errors.push(`${repoPath}: has ${openTemplateTags} <template> tag(s) but ${closeTemplateTags} closing </template> tag(s).`);
  }

  const tagStack = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tagRegex = /<\/?([a-z][a-z0-9-]*)(?:\s[^<>]*)?>/gi;
  let match;
  while ((match = tagRegex.exec(html))) {
    const raw = match[0];
    const name = match[1].toLowerCase();
    if (raw.startsWith("</")) {
      const previous = tagStack.pop();
      if (previous !== name) {
        errors.push(`${repoPath}: closing </${name}> does not match ${previous ? `<${previous}>` : "any open tag"}.`);
        return;
      }
      continue;
    }
    if (raw.endsWith("/>") || voidTags.has(name)) continue;
    tagStack.push(name);
  }
  if (tagStack.length) {
    errors.push(`${repoPath}: unclosed tag(s): ${tagStack.map(name => `<${name}>`).join(", ")}.`);
  }
}

function isManifestResourceCovered(resource, patterns) {
  return patterns.some(pattern => {
    if (pattern === resource) return true;
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`).test(resource);
  });
}

function main() {
  const errors = [];
  const templateFiles = walkFiles(templateDir, ".html").sort();
  const jsFiles = listFiles(jsRoots, ".js");

  const templateTexts = templateFiles.map(filePath => {
    const html = readText(filePath);
    checkTemplateShape(filePath, html, errors);
    return { filePath, html };
  });
  const templateAttributes = mergeAttributeMaps(templateTexts.map(({ html }) => extractDataCcAttributes(html)));

  const jsText = jsFiles.map(readText).join("\n");
  const jsContracts = extractSelectorContracts(jsText);
  for (const [name, requiredValues] of jsContracts.entries()) {
    if (!templateAttributes.has(name)) {
      errors.push(`Missing template attribute: ${name}`);
      continue;
    }

    const templateValues = templateAttributes.get(name);
    for (const value of requiredValues) {
      if (!templateValues.has(value)) {
        errors.push(`Missing template selector value: [${name}="${value}"]`);
      }
    }
  }

  const manifest = JSON.parse(readText(manifestPath));
  const resources = manifest.web_accessible_resources?.flatMap(entry => entry.resources || []) || [];
  const referencedTemplates = extractTemplatePaths(jsText);
  templateFiles.forEach(filePath => referencedTemplates.add(toRepoPath(filePath)));
  for (const templatePath of referencedTemplates) {
    const absolutePath = path.join(rootDir, templatePath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`Referenced template does not exist: ${templatePath}`);
    }
    if (!isManifestResourceCovered(templatePath, resources)) {
      errors.push(`Template is not web-accessible in manifest.json: ${templatePath}`);
    }
  }

  if (errors.length) {
    console.error("Overlay template verification failed:");
    errors.forEach(error => console.error(`- ${error}`));
    process.exit(1);
  }

  console.log(`Overlay template verification passed (${templateFiles.length} template files, ${jsContracts.size} JS selector attributes).`);
}

main();

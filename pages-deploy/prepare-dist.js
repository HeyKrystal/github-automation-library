/**
 * Builds the static directory uploaded to GitHub Pages.
 *
 * Project-specific deployment contents are read from:
 *
 *   .github/pages-config.json -> deploy
 *
 * The implementation intentionally owns the output directory convention:
 *
 *   dist/
 *
 * This keeps "dist" out of every project's configuration. A Pages app should
 * only need to answer one question: "Which files make up my static site?"
 */

import { appendFile, cp, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const CONFIG_PATH = ".github/pages-config.json";
const DIST_DIRECTORY = "dist";

function getSiteRoot() {
    const siteRoot = process.env.SITE_ROOT;

    if (!siteRoot) {
        throw new Error("SITE_ROOT was not provided by the deployment workflow.");
    }

    return resolve(siteRoot);
}

function normalizeRepoPath(value) {
    return value
        .replaceAll("\\", "/")
        .replace(/^\.\/+/, "")
        .replace(/\/+$/, "");
}

function validateRepoPath(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${label} must be a non-empty repository-relative path.`);
    }

    const normalized = normalizeRepoPath(value);

    if (
        isAbsolute(value)
        || normalized === ".."
        || normalized.startsWith("../")
        || normalized.includes("/../")
    ) {
        throw new Error(`${label} must stay inside the repository: ${value}`);
    }

    return normalized;
}

async function setGitHubOutput(name, value) {
    const outputFile = process.env.GITHUB_OUTPUT;

    if (outputFile) {
        await appendFile(outputFile, `${name}=${value}\n`, "utf8");
    }

    console.log(`${name}=${value}`);
}

const siteRoot = getSiteRoot();
const configFile = resolve(siteRoot, CONFIG_PATH);
const config = JSON.parse(await readFile(configFile, "utf8"));

if (!Array.isArray(config.deploy) || config.deploy.length === 0) {
    throw new Error("pages-config.json must contain a non-empty deploy array.");
}

const deployEntries = config.deploy.map((entry, index) =>
    validateRepoPath(entry, `deploy[${index}]`),
);

const distPath = resolve(siteRoot, DIST_DIRECTORY);

// Recreate dist from scratch on every run. This prevents deleted/renamed site
// files from lingering in a previous build and accidentally being deployed.
await rm(distPath, { recursive: true, force: true });
await mkdir(distPath, { recursive: true });

console.log(`Building ${DIST_DIRECTORY}/`);

for (const entry of deployEntries) {
    if (entry === DIST_DIRECTORY || entry.startsWith(`${DIST_DIRECTORY}/`)) {
        throw new Error(`The deploy list cannot include ${DIST_DIRECTORY}/ itself.`);
    }

    const sourcePath = resolve(siteRoot, entry);
    const destinationPath = resolve(distPath, entry);

    // lstat gives a clear failure when a config entry is misspelled or removed.
    // Silent omission would be much harder to diagnose after deployment.
    const source = await lstat(sourcePath);

    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, {
        recursive: source.isDirectory(),
        force: true,
    });

    console.log(`  copied ${entry}`);
}

// upload-pages-artifact runs from the workflow workspace, not from SITE_ROOT.
// Return the path relative to that workspace (normally "site/dist").
const workspaceRoot = resolve(process.env.GITHUB_WORKSPACE || dirname(siteRoot));
const artifactPath = relative(workspaceRoot, distPath).replaceAll("\\", "/");

await setGitHubOutput("path", artifactPath);
console.log(`Deployment artifact is ready at ${artifactPath}`);

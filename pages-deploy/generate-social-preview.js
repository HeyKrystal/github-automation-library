/**
 * Shared social-preview helper used by the reusable Pages deployment workflow.
 *
 * This script deliberately contains NO project-specific paths except the
 * conventions shared by every site using this automation:
 *
 *   Source HTML : social-preview.html
 *   Output PNG  : images/social-preview.png
 *   Image size  : 1200 x 630
 *   Config      : .github/pages-config.json
 *
 * Project-specific assets that affect the preview are listed in
 * socialPreview.watch inside pages-config.json.
 *
 * Commands:
 *
 *   node generate-social-preview.js check
 *       Determines whether this workflow run needs to regenerate the preview.
 *       Writes GitHub Actions outputs named "generate" and "output".
 *
 *   node generate-social-preview.js generate
 *       Renders social-preview.html with Playwright and writes the PNG.
 */

import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Shared conventions
//
// These values are intentionally centralized here instead of repeated in every
// site's config. If the convention ever changes for all of your sites, change
// it once in this shared repository.
// ---------------------------------------------------------------------------
const CONFIG_PATH = ".github/pages-config.json";
const PREVIEW_SOURCE = "social-preview.html";
const PREVIEW_OUTPUT = "images/social-preview.png";
const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const PAGE_LOAD_TIMEOUT_MS = 30_000;

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

async function loadConfig(siteRoot) {
    const configFile = resolve(siteRoot, CONFIG_PATH);
    const config = JSON.parse(await readFile(configFile, "utf8"));
    const socialPreview = config.socialPreview ?? {};

    if (
        socialPreview.skipGeneration !== undefined
        && typeof socialPreview.skipGeneration !== "boolean"
    ) {
        throw new Error("socialPreview.skipGeneration must be true or false.");
    }

    const watch = socialPreview.watch ?? [];

    if (!Array.isArray(watch)) {
        throw new Error("socialPreview.watch must be an array of file/folder paths.");
    }

    return {
        skipGeneration: socialPreview.skipGeneration ?? false,
        watch: watch.map((entry, index) =>
            validateRepoPath(entry, `socialPreview.watch[${index}]`),
        ),
    };
}

/**
 * A configured watch entry may name either a single file OR a folder.
 *
 * Example:
 *   "images/app-icon.png" watches only that file.
 *   "images" watches the entire images folder recursively.
 *
 * This intentionally avoids glob syntax so pages-config.json stays easy to
 * understand years later.
 */
function watchMatches(changedFile, watchedPath) {
    return (
        changedFile === watchedPath
        || changedFile.startsWith(`${watchedPath}/`)
    );
}

async function setGitHubOutput(name, value) {
    const outputFile = process.env.GITHUB_OUTPUT;

    if (outputFile) {
        await appendFile(outputFile, `${name}=${value}\n`, "utf8");
    }

    console.log(`${name}=${value}`);
}

async function commitExists(siteRoot, sha) {
    try {
        await execFileAsync("git", ["cat-file", "-e", `${sha}^{commit}`], {
            cwd: siteRoot,
        });
        return true;
    } catch {
        return false;
    }
}

async function checkPreview() {
    const siteRoot = getSiteRoot();
    const config = await loadConfig(siteRoot);
    const outputPath = resolve(siteRoot, PREVIEW_OUTPUT);

    await setGitHubOutput("output", PREVIEW_OUTPUT);

    // Project either has a hand designed preview, or does not utilize one.
    if (config.skipGeneration) {
        console.log("Social preview generation is skipped by project configuration.");
        await setGitHubOutput("generate", "false");
        return;
    }

    // If no output exists yet, there is nothing useful to compare; generate it.
    try {
        await access(outputPath);
    } catch {
        console.log("Social preview output is missing and will be generated.");
        await setGitHubOutput("generate", "true");
        return;
    }

    // workflow_dispatch is your deliberate "rebuild it now" button.
    if (process.env.CALLER_EVENT_NAME === "workflow_dispatch") {
        console.log("Manual workflow run: social preview will be regenerated.");
        await setGitHubOutput("generate", "true");
        return;
    }

    const beforeSha = process.env.CALLER_BEFORE_SHA;
    const currentSha = process.env.CALLER_SHA;

    // GitHub uses an all-zero before SHA for some first-push scenarios. When a
    // comparison cannot be trusted, regenerating once is safer than skipping.
    if (
        !beforeSha
        || !currentSha
        || /^0+$/.test(beforeSha)
        || !(await commitExists(siteRoot, beforeSha))
    ) {
        console.log("No usable comparison commit; social preview will be regenerated.");
        await setGitHubOutput("generate", "true");
        return;
    }

    const { stdout } = await execFileAsync(
        "git",
        ["diff", "--name-only", beforeSha, currentSha],
        { cwd: siteRoot },
    );

    const changedFiles = stdout
        .split(/\r?\n/)
        .map(normalizeRepoPath)
        .filter(Boolean)
        // The generated PNG is an output, not a preview input. Ignoring it is
        // especially important when a project watches the whole images folder.
        .filter((file) => file !== PREVIEW_OUTPUT);

    // The HTML source and config file are always relevant. The project config
    // only has to list ADDITIONAL assets such as images used by the preview.
    const watchedPaths = [
        PREVIEW_SOURCE,
        CONFIG_PATH,
        ...config.watch,
    ];

    const relevantChanges = changedFiles.filter((file) =>
        watchedPaths.some((watchedPath) => watchMatches(file, watchedPath)),
    );

    if (relevantChanges.length === 0) {
        console.log("No social preview inputs changed; generation will be skipped.");
        await setGitHubOutput("generate", "false");
        return;
    }

    console.log("Social preview inputs changed:");
    for (const file of relevantChanges) {
        console.log(`  - ${file}`);
    }

    await setGitHubOutput("generate", "true");
}

async function generatePreview() {
    const siteRoot = getSiteRoot();
    const config = await loadConfig(siteRoot);

    if (config.skipGeneration) {
        console.log("Social preview generation is skipped by project configuration.");
        return;
    }

    const sourcePath = resolve(siteRoot, PREVIEW_SOURCE);
    const outputPath = resolve(siteRoot, PREVIEW_OUTPUT);

    await access(sourcePath);
    await mkdir(dirname(outputPath), { recursive: true });

    // Playwright is installed in this shared automation repository, so caller
    // projects do not need Playwright in their own package.json.
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
        const page = await browser.newPage({
            viewport: {
                width: PREVIEW_WIDTH,
                height: PREVIEW_HEIGHT,
            },
            deviceScaleFactor: 1,
            // Keep media-query behavior deterministic and aligned with the
            // dark-mode social previews used by these projects.
            colorScheme: "dark",
        });

        await page.goto(pathToFileURL(sourcePath).href, {
            waitUntil: "load",
            timeout: PAGE_LOAD_TIMEOUT_MS,
        });

        // Network idle covers CSS background images and other resources that
        // may not be represented by document.images.
        await page.waitForLoadState("networkidle", {
            timeout: PAGE_LOAD_TIMEOUT_MS,
        });

        // Wait for fonts and ordinary <img> elements before capturing so the
        // generated PNG is deterministic rather than timing-dependent.
        await page.evaluate(async () => {
            await document.fonts.ready;

            await Promise.all(
                Array.from(document.images).map(async (image) => {
                    if (!image.complete) {
                        await new Promise((resolveImage, rejectImage) => {
                            image.addEventListener("load", resolveImage, { once: true });
                            image.addEventListener("error", rejectImage, { once: true });
                        });
                    }

                    if (typeof image.decode === "function") {
                        await image.decode();
                    }

                    if (image.naturalWidth === 0) {
                        throw new Error(
                            `Image failed to load: ${image.currentSrc || image.src}`,
                        );
                    }
                }),
            );
        });

        await page.screenshot({
            path: outputPath,
            type: "png",
            fullPage: false,
            // Social previews should capture a stable frame, not whichever
            // point an animation happened to reach during CI.
            animations: "disabled",
        });

        console.log(`Generated ${PREVIEW_OUTPUT}`);
    } finally {
        await browser.close();
    }
}

const command = process.argv[2];

switch (command) {
    case "check":
        await checkPreview();
        break;

    case "generate":
        await generatePreview();
        break;

    default:
        throw new Error("Expected command: 'check' or 'generate'.");
}

# GitHub Automation 🤖

Shared GitHub Actions automation for small static web applications.

The main goal of this repository is **low cognitive overhead** for simple github pages hosted pages or webapps.

## GitHub Pages deployment

The reusable Pages workflow provides one standard deployment path:

```text
push to main / manual run
        ↓
check whether social-preview inputs changed
        ↓
regenerate + commit preview only when needed
        ↓
build dist/ from the project's deploy list
        ↓
upload one Pages artifact
        ↓
deploy once
```

### Project-side files

A consuming project only needs:

```text
.github/workflows/pages.yml
.github/pages-config.json
```

Templates for both are in [`templates/`](templates/).

### Conventions

These are intentionally conventions rather than per-project configuration:

```text
Social preview source : social-preview.html
Social preview output : images/social-preview.png
Social preview size   : 1200 × 630
Pages build directory : dist/
Project config         : .github/pages-config.json
```

Keeping these fixed removes settings that would otherwise have to be remembered
and repeated in every project.

## Project configuration

Example:

```json
{
  "deploy": [
    "index.html",
    "styles",
    "src",
    "images"
  ],
  "socialPreview": {
    "skipGeneration": false,
    "watch": [
      "images"
    ]
  }
}
```

### `deploy`

Files/directories that make up the static website. Paths are copied into
`dist/` while preserving their repository-relative layout.

Missing paths fail the build intentionally; a typo should not silently publish
an incomplete site.

### `socialPreview.skipGeneration`

```text
false → render social-preview.html into images/social-preview.png
true  → use the existing images/social-preview.png without generating it
```

Use `true` when a project has a manually designed PNG instead of an HTML-based
preview. The workflow verifies that the PNG exists.

### `socialPreview.watch`

Additional files or folders that affect the generated preview.

No glob syntax is required:

```json
"watch": [
  "images",
  "some/specific/file.json"
]
```

A folder watches everything below it recursively. `social-preview.html` and the
project config itself are watched automatically.

## Versioning

Projects should call the reusable workflow through the compatible major
reference:

```yaml
uses: HeyKrystal/github-automation-library/.github/workflows/pages-deploy.yml@v1
```

Compatible fixes can continue under `v1`. A future incompatible configuration change will become `v2` so existing sites keep working unchanged.

The reusable workflow also loads its helper scripts from the same `v1` ref so
workflow logic and implementation stay in sync.

## Dependencies

Playwright's `package.json` and `package-lock.json` live in this repository
because Playwright belongs to the deployment tooling, not to the individual web
applications. Caller repositories do not need a second npm project or a
Playwright dependency merely to generate their social preview.
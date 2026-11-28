# Product page maintenance

The GitHub Pages site is an introduction to ProseMap, separate from the Tauri
application. It is static HTML, CSS and JavaScript; it does not load the editor,
send model requests, collect analytics or require a frontend build.

## Source

- [English page](../website/index.html)
- [Simplified Chinese page](../website/zh/index.html)
- [Shared styles](../website/assets/site.css) and [interactions](../website/assets/site.js)
- [3D diagram and source views](../website/assets/folio.css) and [diagram symbols](../website/assets/site-symbols.svg)
- [English example](../website/assets/launch-plan.md) and [Chinese example](../website/assets/launch-plan.zh-CN.md)
- [Screenshot provenance](marketing-assets.md)

Keep both language pages and both READMEs in sync when updating capabilities,
download links, version labels and platform availability. Downloads deliberately
target a specific preview version: GitHub's `releases/latest` can skip prereleases.
Verify the actual release assets before changing links.

## Preview

From the repository root, using Python 3:

```bash
python3 -m http.server 4174 --bind 127.0.0.1 --directory website
```

Open the loopback URL printed by the server. The Chinese page is at `/zh/`.
Check the diagram and source views in both languages with the mouse and arrow
keys. The source on the reverse matches the Mermaid block in the downloadable
example. Both views work with JavaScript disabled and switch immediately when
reduced motion is enabled.

Check both languages on desktop and mobile, all four screenshot tabs, keyboard
navigation, image enlargement and Escape, FAQ disclosures, example downloads,
and package links. Follow **Write together / 共享写作** to the collaboration
feature, enlarge the two-editor screenshot, and check the setup guide link.
Without JavaScript, all four tour screenshots remain visible and
the image links and FAQ still work.

All shipped assets are local. Relative asset links support the `/prosemap/`
project prefix. If the repository or hosting address changes, update canonical,
alternate-language and social metadata in both HTML pages and product-page links
in both READMEs.

## Deployment

The site is published from the root of the `gh-pages` branch. Keep `website/` on
`main` as the editable source; export that directory after merging a site update.
The included `.nojekyll` file lets GitHub serve the static files directly.

With a clean checkout of the updated `main` branch, prepare the publishing branch:

```bash
git fetch origin
git subtree split --prefix=website -b pages-publication main
```

Inspect every outgoing commit, its author and committer, the complete diff and
changed images on `pages-publication`, following the publication requirements
below. Compare with `origin/gh-pages` when it exists; review the whole branch for
the first publication. Only after that inspection is clean, publish:

```bash
git push origin pages-publication:gh-pages
git branch -D pages-publication
```

For the initial setup, select **Settings → Pages → Build and deployment → Source
→ Deploy from a branch**, then choose **gh-pages** and **/(root)**. Later pushes
to that branch update the site. See [GitHub's publishing-source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Check the Pages deployment result and both public language pages after each
publication. This branch-based deployment does not require a custom Actions
workflow or a local frontend build.

Before public pushes, follow [the repository's publication requirements](../AGENTS.md):
inspect the complete outgoing commit range, metadata, text and images for private
information. Keep raw captures, logs and audit details under ignored `outputs/`.
Only curated product images and synthetic examples belong in `website/`.
Documentation publication does not create or validate a new desktop release.

## Refresh screenshots

Build and serve the actual production frontend:

```bash
npm run build
npm run preview -- --port 1422
```

In another terminal:

```bash
node --experimental-strip-types scripts/capture-marketing.mjs
```

The script uses the existing Playwright installation and synthetic native IPC
helpers. It writes full-size PNG captures into ignored `outputs/marketing/` and
refreshes the two rendered Mermaid SVG assets. It never uses a real API key or
calls a model service. Inspect every capture, convert approved PNGs to WebP, and
replace the corresponding files in `website/assets/screenshots/`. Preserve their
origin metadata and update [the asset record](marketing-assets.md).

Keep the simulation disclosure visible in both READMEs and both product pages.

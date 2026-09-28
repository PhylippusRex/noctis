# Noctis — web/

Static site (no build step). Fetches `../data/briefing.json` and
`../data/archive/*.json` from the repo root, which your nightly GitHub
Action already writes.

## 1. Where this folder goes
Drop this whole `web/` folder into the root of your existing `noctis`
repo, next to `backend/` and `data/`:

```
noctis/
  backend/
  data/
    briefing.json
    archive/
  web/          <- this folder
    index.html
    style.css
    app.js
    logo.png ...
```

## 2. Archive date picker (optional but recommended)
The date dropdown reads `data/archive/index.json`, a simple list of
dates. Add this step to `.github/workflows/nightly.yml`, right after
the "Save results" step already commits `data/archive/<date>.json`:

```yaml
      - name: Build archive index
        run: |
          python3 -c "
          import json, os
          files = sorted(f[:-5] for f in os.listdir('data/archive') if f.endswith('.json') and f != 'index.json')
          json.dump({'dates': list(reversed(files))}, open('data/archive/index.json','w'))
          "
          git add data/archive/index.json
          git commit -m "Update archive index" || echo "nothing to commit"
          git push
```
Until you add this, the site still works fine — it just shows only
"Latest briefing" with no date picker options.

## 3. Fonts
Body font (Nunito) loads from Google Fonts automatically — nothing to
do. The heading font, **Soria**, is not on Google Fonts. Until you add
it, headings fall back to Marcellus (a similar elegant serif, also
free from Google Fonts), so the site looks good either way.

To use the real Soria:
1. Go to fontsquirrel.com/fonts/soria — it's free, OFL-licensed.
2. Download the "Webfont Kit" (gives you `.woff2`/`.woff` files).
3. Put `soria-regular.woff2` and `soria-regular.woff` into `web/fonts/`.
4. Reload the site — the `@font-face` rule in `style.css` picks it up
   automatically, no other change needed.

## 4. Test it locally on your phone
From the repo root in Termux:
```bash
cd noctis
python3 -m http.server 8080
```
Then open `http://127.0.0.1:8080/web/` in your phone's browser.

## 5. Deploy (Cloudflare Pages, free)
1. Push this folder to GitHub (part of your existing `noctis` repo).
2. On pages.cloudflare.com, connect the `noctis` repo.
3. Build settings: **Framework preset: None**, **Build command:**
   (leave blank), **Build output directory:** `web`.
4. Deploy. You'll get a `*.pages.dev` URL immediately.
5. In Cloudflare Pages → Custom domains, add `noctis.xyz` (after you've
   bought it and pointed its nameservers at Cloudflare).

## 6. Files in this folder
- `index.html` / `style.css` / `app.js` — the whole site
- `logo.png`, `favicon.png`, `icon-192.png`, `og.png` — generated from
  your uploaded logo
- `fonts/` — put Soria's webfont files here (see step 3)

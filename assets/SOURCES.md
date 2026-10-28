# Official application icons

Gemini: https://www.gstatic.com/lamda/images/gemini_sparkle_4g_512_lt_f94943af3be039176192d.png (favicon declared by gemini.google.com)

Antigravity: https://antigravity.google/favicon.svg

Downloaded on 26 October 2026. The Antigravity SVG used in the README has only its theme-dependent background circle removed for transparency; its logo paths, masks, filters and colors are unchanged. Other source assets are unmodified.

`assets/icons/antigravity.png` is the application icon from the official Antigravity App 2.26.0 Linux AppImage. `assets/icons/gemini-*.png` are resized versions of the Gemini website favicon listed above. Source assets remain separate from generated runtime display files.

`assets/icons/antigravity.ico` and `assets/icons/gemini.ico` are Windows ICO containers holding the corresponding 256px PNG asset, with no visual changes.

`assets/logos/windows.svg` is a minimal four-pane platform indicator drawn for this repository to identify Windows; the Windows name and platform mark belong to Microsoft.

The extension assets in `common/browser-extension/assets/` use the official Antigravity favicon SVG above with its background circle removed, as in the README. The PNG sizes are rendered from this SVG; these are Google brand assets, not original plugin artwork.

## Browser picker icons

Bundled on 28 October 2026 under `assets/browsers/`, without visual modifications. They identify installed browsers and are loaded locally; the picker makes no requests to these hosts. Browser marks remain the property of their respective owners and are excluded from the plugin's 0BSD license.

| Browser | Official asset source |
| --- | --- |
| Brave | https://brave.com/static-assets/images/cropped-brave_appicon_release-192x192.png |
| Chrome | https://www.google.com/chrome/static/images/favicons/android-icon-192x192.png |
| Chromium | https://raw.githubusercontent.com/chromium/chromium/main/chrome/app/theme/chromium/product_logo_64.png |
| Edge | https://edgestatic.azureedge.net/welcome/static/favicon.png |
| Opera | https://cdn-production-opera-website.operacdn.com/staticfiles/assets/images/favicon/opera/apple-touch-icon-180x180.91bbceaeaa8a.png |
| Vivaldi | https://vivaldi.com/wp-content/uploads/cropped-favicon-192x192.png |

Vivaldi image credit: **Vivaldi Technologies**, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as stated on its [Press & Media page](https://vivaldi.com/press/). Logos remain subject to trademark restrictions.

The Chromium source-tree license is retained in `assets/browsers/CHROMIUM-LICENSE.txt` from https://raw.githubusercontent.com/chromium/chromium/main/LICENSE.

## Model laboratory icons

Unmodified official favicons, bundled on 28 October 2026 for local model-provider identification:

- Anthropic: https://www.anthropic.com/images/icons/favicon-32x32.png
- Google: https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png
- OpenAI: https://developers.openai.com/favicon.png

These marks belong to their respective owners and are excluded from the plugin's 0BSD license.

## Offline artifact preview engines

The reproducible bundle is built from pinned npm packages in `package-lock.json`; users do not download scripts at runtime. Original licenses and dependency notices are retained in `assets/viewers/LICENSES.txt`.

- PDF.js 6.4.299: https://github.com/mozilla/pdf.js (Apache-2.0).
- Three.js 0.186.1, including GLTFLoader, OBJLoader, STLLoader, PLYLoader and OrbitControls: https://github.com/mrdoob/three (MIT).
- docx-preview 0.4.1: https://github.com/VolodymyrBaydalka/docxjs (MIT), using JSZip 3.10.2 under its MIT license option.
- fflate 0.8.3: https://github.com/101arrowz/fflate (MIT).
- marked 18.1.2: https://github.com/markedjs/marked (MIT).
- DOMPurify 3.4.17: https://github.com/cure53/DOMPurify (Apache-2.0 or MPL-2.0).

The colored header logo reuses the existing official Antigravity vector with a tighter SVG view box; no new logo is synthesized.

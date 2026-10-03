# HTML Layers

Chrome extension that draws the semantic structure of any page as layers over the content: headings, landmarks and lists.

## What it checks (MVP)

- **Headings**: h1-h6 and `role="heading"`, effective level (including `aria-level`), skipped levels, empty headings, missing or repeated h1, headings with semantics removed
- **Landmarks**: banner, navigation, main, contentinfo, complementary, search, form and region, with accessible names, missing or repeated main, repeated landmarks without a name
- **Lists** (optional layer): item count, empty lists, invalid children
- **Visibility**: hidden elements are listed in the panel, visually hidden or off-screen ones are drawn dashed

## Install for development

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and pick this folder
4. Open any website and click the HTML Layers icon (or press Alt+Shift+L)

After editing the code, click the reload button on the extension card and reload the page.

## Tweaking the overlay in DevTools

The marks are redrawn on every scroll and hover, so editing them directly gets overwritten. Instead, every visual parameter is a CSS variable on the overlay host:

1. Open DevTools > Elements and select `<html-layers-overlay>` (last child of `<html>`)
2. In Styles > `element.style`, add any variable below. The overlay redraws right away
3. To edit the marks by hand, add `--hl-freeze: 1` (stops redrawing), then expand `#shadow-root`

| Variable | Default | What it does |
|---|---|---|
| `--hl-line` / `--hl-line-active` | 2px / 3px | Line width, normal and on hover or selection |
| `--hl-radius` / `--hl-landmark-radius` | 4px / 6px | Box corners |
| `--hl-fill` / `--hl-landmark-fill` | 28% / 10% | Fill on hover |
| `--hl-chip-height`, `--hl-chip-font`, `--hl-chip-pad` | 22px, 12px, 8px | Chip size |
| `--hl-heading-chip-min` | 36px | Minimum width of heading chips |
| `--hl-chip-attach` | 1 | 1 sits the chip on the box line, 0 makes it float |
| `--hl-chip-overlap` | 2px | How much the attached chip covers the box line |
| `--hl-veil` | 0.45 | Veil opacity |
| `--hl-pad-x` / `--hl-pad-y` | 6px / 4px | Space around headings and lists |
| `--hl-landmark-inset` | 3px | Landmarks drawn this much inside the element |
| `--hl-grow` | 4px | Room landmarks leave around the marks inside them |
| `--hl-lift` | 0px | How much a box grows on hover or selection (0 keeps everything still) |
| `--hl-chip-gap` | 1px | Space between chip and box |
| `--hl-freeze` | 0 | 1 stops redrawing |

Colors can be overridden the same way (`--heading`, `--heading-line`, etc.). Defaults live in `TWEAKS`, `TOKENS` and `THEMES` in `content/content.js`.

## Structure

- `manifest.json` - Manifest V3, permissions: `sidePanel`, `activeTab`, `scripting`, optional access to all sites
- `background.js` - opens the side panel when the icon is clicked
- `content/scan.js` - detection and validation rules
- `content/content.js` - overlay layer (Shadow DOM, drawn over the page) and link with the panel
- `panel/` - side panel UI

## Privacy

HTML Layers runs only on the tab where you click it. Nothing is collected, stored or sent anywhere.

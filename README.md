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

## Structure

- `manifest.json` - Manifest V3, permissions: `sidePanel`, `activeTab`, `scripting`, optional access to all sites
- `background.js` - opens the side panel when the icon is clicked
- `content/scan.js` - detection and validation rules
- `content/content.js` - overlay layer (Shadow DOM, drawn over the page) and link with the panel
- `panel/` - side panel UI

## Privacy

HTML Layers runs only on the tab where you click it. Nothing is collected, stored or sent anywhere.

# Spritesheet Editor

A browser-based tool for cropping sprites out of a sprite sheet (e.g. an
AI-generated character sheet) with consistent bounding boxes, then exporting
each sprite as a PNG inside a single ZIP.

Everything runs client-side — no upload, no server.

## Features

- **Four crop modes**
  - **Free draw** — drag the first box; subsequent boxes lock to that size
  - **Grid slice** — set rows/cols (and optional padding) and slice the whole sheet
  - **Click to place** — drop a fixed-size box wherever you click
  - **Auto detect** — find connected non-background regions and (optionally) normalize them to a uniform size
- **Background removal** — by sampled color (eyedropper) or magic-wand flood fill, applied on export
- **Pixel-perfect editing** — at 6×+ zoom a pixel grid appears; selected boxes show live W×H + position; arrow keys nudge by 1 px (Shift = 10 px); `R` toggles resize mode so the arrow keys adjust dimensions instead
- **Sprite sidebar** — live thumbnails, rename, delete, normalize-all-to-largest
- **Export** — every sprite as an individual PNG inside `sprites.zip`

## Keyboard shortcuts

| Key                 | Action                              |
| ------------------- | ----------------------------------- |
| `V`                 | Select tool                         |
| `H` / `Space`       | Pan tool                            |
| `M`                 | Free-draw crop                      |
| `G`                 | Grid slice                          |
| `C`                 | Click-to-place                      |
| `A`                 | Auto-detect                         |
| `I`                 | Eyedropper (pick BG color)          |
| `W`                 | Magic wand                          |
| `F` / `0`           | Fit to view                         |
| `+` / `-`           | Zoom in / out                       |
| `←↑↓→`              | Nudge selected box (Shift = 10 px)  |
| `R`                 | Toggle resize mode for arrow keys   |
| `Del` / `Backspace` | Delete selected sprite              |
| `Esc`               | Deselect / exit resize mode         |

## Running locally

It's static — any HTTP server works:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

The `.jsx` files are transpiled in the browser by Babel standalone, so no
build step is required.

## Deployment

A GitHub Actions workflow (`.github/workflows/deploy.yml`) deploys the repo
contents to GitHub Pages on every push to `main`.

## Stack

- React 18 (UMD)
- Babel standalone (in-browser JSX transpile)
- JSZip for the export bundle
- Plain CSS, Geist + Geist Mono via Google Fonts

## Credits

Designed in [Claude Design](https://claude.ai/design); implemented by a
coding agent following the design handoff.

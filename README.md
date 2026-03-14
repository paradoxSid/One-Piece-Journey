# One Piece Journey Map

An interactive Google Apps Script web app that displays a stylized map of the One Piece world. Select any Straw Hat crew member from the dropdown and watch their journey animate across the seas — from their origin island through every arc.

## Features

- **SVG World Map** — Stylized map with the Grand Line, Red Line, Calm Belts, Four Blues, and 40+ islands
- **Crew Selection** — Scrollable pill selector for all 10 Straw Hat crew members
- **Animated Journey** — Smooth path-drawing animation with a ⛵ ship icon traveling the route
- **Pre-join / Post-join Paths** — Dashed lines show each character's origin story; solid lines show their time with the crew
- **Character Info Card** — Bounty, Devil Fruit, role, island count, and bio for each member
- **Island Tooltips** — Hover/tap any island to see its name, arc, and sea
- **Pan & Zoom** — Drag to pan, pinch/scroll to zoom, or use the toolbar buttons
- **Pirate Theme** — Dark ocean aesthetic with Pirata One font, compass rose, and wave patterns

## Crew Members

| Member | Role | Joined At |
|--------|------|-----------|
| Monkey D. Luffy | Captain | Foosha Village |
| Roronoa Zoro | Swordsman | Shells Town |
| Nami | Navigator | Arlong Park |
| Usopp | Sniper | Syrup Village |
| Vinsmoke Sanji | Cook | Baratie |
| Tony Tony Chopper | Doctor | Drum Island |
| Nico Robin | Archaeologist | Alabasta |
| Franky | Shipwright | Water 7 |
| Brook | Musician | Thriller Bark |
| Jinbe | Helmsman | Wano Country |

## Project Structure

```
One Piece Journey/
├── Code.js      — GAS backend: doGet(), include(), island & crew data
├── index.html   — HTML shell: top bar, selector, map container, info card
├── styles.html  — CSS: dark pirate theme, animations, responsive layout
├── app.html     — Frontend JS: SVG rendering, path animation, gestures
└── README.md    — This file
```

## Setup

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Copy each file into the project (Code.js as a `.gs` file, the rest as HTML files)
3. **Deploy → New deployment → Web app**
4. Set *Execute as* = **Me**, *Who has access* = **Anyone**
5. Open the deployment URL

No database, API keys, or external services needed — all data is self-contained.

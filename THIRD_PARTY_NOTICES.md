# Third-party notices

WebCockpit is GPL-3.0-or-later (ADR 0001). It ships the following
third-party material, each under its own GPL-compatible licence.

## Fonts (`public/fonts/`)

- **DejaVu Sans Mono** 2.37 (regular, bold), converted to WOFF2.
  Bitstream Vera Fonts licence (Copyright (c) 2003 Bitstream, Inc.), DejaVu
  changes in the public domain, Arev glyphs (c) Tavmjong Bah.
  Full text: `public/fonts/LICENSE-DejaVu.txt`.
- **JetBrains Mono** 2.304, NL build (regular, bold), converted to WOFF2.
  Copyright 2020 The JetBrains Mono Project Authors. SIL Open Font
  License 1.1. Full text: `public/fonts/LICENSE-JetBrainsMono-OFL.txt`.

Sources, versions and the conversion are recorded in
`public/fonts/README.md`.

## JavaScript libraries (bundled into the build)

- **Preact** 10.29.8 — MIT License, Copyright (c) 2015-present Jason
  Miller. Used for the start page, ESC menu and Options chrome
  (`src/chrome/`), loaded as a separate chunk. Licence text:
  `node_modules/preact/LICENSE` (MIT, GPL-compatible).
- **CodeMirror 6** — `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.13,
  `@codemirror/commands` 6.11.1 and their dependencies `@codemirror/language`
  6.12.4, `@lezer/common` 1.5.3, `@lezer/highlight` 1.2.4, `@lezer/lr` 1.4.10,
  `style-mod` 4.1.4, `w3c-keyname` 2.2.8, `crelt` 1.0.7 — MIT License,
  Copyright (C) 2018-2021 by Marijn Haverbeke and others. Used for the
  profile editor's text view (`src/editor/`), loaded as a separate chunk.
  Licence texts: `node_modules/<package>/LICENSE` (MIT, GPL-compatible).

## Map assets (`public/map/`)

- **MMapper** 26.06.0 default tileset (`pixmaps/`), GPL-2.0-or-later,
  Copyright (C) The MMapper Authors.
- **Cantarell** bitmap fonts (`fonts/`), SIL Open Font License 1.1.
- **arda.mm2**, a MUME map whose room texts belong to MUME.

Details and licence texts: `public/map/README`.

# Research: MUME XML mode

> Status: research note, 2026-09-27. Input to the line layer
> (`src/text/assembler.ts`, ADR 0003). Not authoritative.
>
> Sources (knowledge only, no code copied):
> - MUME help `change xml` (<https://mume.org/help/change_xml>).
> - MMapper `src/parser/mumexmlparser.cpp` (master, and v19.04.0 for the
>   older `movement` handling), <https://github.com/MUME/MMapper>.
> - MMapper issue #101 (MUME escapes `< > & ' "`; MMapper's raw output
>   does not).
> - Cockpit raw logs (`/home/ole/MUME/data/runs/*/*.log`) for what non-XML
>   output looks like. Cockpit never used XML mode, so there are no real
>   XML samples yet.

## Turning it on and off

- `change xml on|off`, or the MPI sequence `~$#EX1\n<state>\n` (0 off,
  1 on, 2 off without tags, 3 on without tags).
- WebCockpit uses GMCP `MUME.Client.XML {"enable":true,"silent":true}`
  (spec stage 1).
- MUME sends `<xml>` when XML mode is turned on and `</xml>` when it is
  turned off (the MPI states 2/3 suppress these). MMapper treats `</xml>`
  as "XML mode is off".

## Tags

From the help page (subject to change, "there will be more tags"):

| Group | Tags |
|---|---|
| Structure | `xml`, `prompt`, `room`, `name`, `description`, `terrain`, `exits`, `exit`, `magic`, `header`, `status`, `snoop` |
| Movement | `movement`, `move_in`, `move_out` |
| Comms | `tell`, `say`, `narrate`, `song`, `pray`, `shout`, `yell`, `emote`, `social` |
| Combat | `hit`, `damage`, `miss`, `avoid_damage` |
| Names | `character`, `player`, `enemy`, `object`, `familiar` |
| Other | `weather`, `achievement`, `gratuitous`, `code`, `em`, `highlight` |

Attributes:

- `room`: `terrain="..."`, `area="..."`, optional `id=<n>`.
- `movement`: `dir=<north|south|east|west|up|down>`; `<movement/>` for an
  unknown direction. Self-closing, unquoted value: `<movement dir=north/>`.
- `exit`: `dir=<dir>`, optional `id=<n>`.
- `highlight`: `type=<name>`. `snoop`: `symbol=<string>`.
- "Attribute values use HTML syntax": unquoted, `'single'` or `"double"`.
  MMapper ends an unquoted value at whitespace or `/`.

## Text and entities

- In XML mode MUME escapes `<`, `>`, `&` (and quotes) as entities, so any
  `<` in the stream starts a tag. The assembler decodes `&lt; &gt; &amp;
  &quot; &apos; &nbsp;` and numeric `&#NN;` / `&#xHH;`; anything else stays
  literal.
- Outside XML mode `<` is common literal text: equipment slots
  (`<wielded>`, `<worn on belt>`), `who` flags (`<WE> Name`), prompts
  (`*<* R>`, `!<~ HP:Fine>`), help syntax (`tell <name>`). The assembler
  therefore recognises only `xml`, `prompt`, `room` and `movement` until
  the first recognised tag switches XML mode on, and does not decode
  entities before then.
- ANSI colour still appears inside XML elements.

## Structure and line interplay

- Elements span lines: `<room>` wraps name, description (several lines),
  exits and contents; `<description>` spans lines. The assembler emits one
  span per line an element touches and none on a line where the element
  closes at offset 0.
- MMapper processes the stream per telnet unit (a line, or a GA-terminated
  prompt) and keeps the open-element state across units, which confirms
  that tags cross line boundaries.
- Prompt: `<prompt>...</prompt>` followed by IAC GA with no newline
  (MMapper's parser treats the GA unit as the prompt and resets the prompt
  state on `</prompt>`). The assembler marks a line with a `prompt` span as
  a prompt, but emits it only on GA (or LF), so `<prompt>…</prompt>` + GA
  gives exactly one prompt line. The UI sees it earlier as `text.partial`.
- After a GA prompt MUME starts the next output with CRLF, which gives an
  empty line (Cockpit's logs show the same blank line after each prompt).

## To verify live

1. Does MUME send `<xml>` after the GMCP enable with `"silent":true`? If
   not, XML mode is detected at the first `<prompt>`/`<room>`/`<movement>`.
2. Is every prompt followed by IAC GA in XML mode (otherwise prompts stay
   partial until the next newline)?
3. Exact nesting of `<room>`, `<exits>` and the room contents lines, and
   whether `</room>` comes before or after the final CRLF.
4. Whether any other tags arrive before the first structural one (they
   would show as literal text until XML mode is detected).

# Research: MMapper integration for WebCockpit

> Status: research note, 2026-09-27. Input to `spec.md` (intent Goal 9).
> Not authoritative; decisions go into ADRs.
>
> Sources read: MMapper `master` @ `cca5ea3` (2026-09-15, version 26.06.0),
> `MUME/play-mume` @ `012738a` (2026-09-12), `MUME/arda`, mume.org help
> pages, Cockpit (`/home/ole/MUME`, read-only). Paths below are relative to
> the respective repo root. No connection to MUME's game server was made.

## TL;DR

- **MMapper Web exists and works:** <https://docs.mume.org/MMapper/demo/>
  (moved from `mume.github.io/MMapper/demo/`). It is the full Qt desktop
  app compiled to WebAssembly: its own terminal client + map, ~36.6 MB
  `.wasm`, WebGL2, pthreads (needs cross-origin isolation). It has **no JS
  API**: nothing can feed it a game stream without patching.
- **Transport both MMapper Web and Play MUME use:**
  `wss://mume.org:443/ws-play/`, subprotocol `binary`, binary frames with
  raw telnet bytes (IAC etc.) in both directions. We implement telnet in JS.
- **Modern MMapper maps mostly from GMCP, not XML.** `Room.Info` gives a
  server room `id`, name, desc, area, terrain and per-exit destination
  `id`s. `Event.Moved` gives the direction. Room matching is an id lookup;
  MMapper's name/desc/exit path machine only runs for rooms without ids
  (mazes, old maps). XML mode is still requested and parsed for
  prompt, exits text, room contents, weather, snoop.
- **A browser map already exists without MMapper code:** Play MUME
  (`mume.org/play/browser`) is TypeScript + PIXI and uses MMapper's
  **web JSON map export** plus only GMCP `Room.Info` / `Event.Moved`.
- **Recommendation:** option (c): our own map pane in TS, reading
  MMapper's exported map formats and matching by GMCP ids. Build the stage-1
  architecture so that option (a) (a patched MMapper WASM in an iframe fed
  by our stream) stays possible. Reject (b).
- **Risk for intent's "no server" constraint:** every known browser client
  on `ws-play` is served from a MUME origin (`mume.org`,
  `docs.mume.org`). That MUME accepts a WebSocket from a third-party origin
  is **not** shown by MMapper Web working. Verify early (see §6).

## 1. MMapper architecture and protocol

### 1.1 Proxy pipeline

`src/proxy/proxy.cpp:236-246`:

```
UserSocket -> UserTelnet -> UserTelnetFilter -> (User)Parser
MudSocket  -> MudTelnet  -> MudTelnetFilter  -> MpiFilter -> { RemoteEdit or (Mud)Parser }
```

- Desktop: listens on TCP `localhost:4242` for an external client
  (`src/proxy/connectionlistener.cpp`). On WASM, `listen()` returns
  immediately (`connectionlistener.cpp:72`) and only the built-in client
  (`src/client/`, via `VirtualSocket`) can connect.
- MUD side (`src/proxy/mumesocket.cpp`): TLS → WebSocket → plaintext
  fallback on desktop. WASM always uses WebSocket (`mumesocket.cpp:124`).
- The user parser (`src/parser/AbstractParser-*.cpp`) intercepts
  `_`-prefixed commands (`_connect`, `_disconnect`, `_search`, …) and
  queues movement commands for path prediction.

### 1.2 What it negotiates with MUME (`src/proxy/MudTelnet.cpp`, `AbstractTelnet.cpp`)

- Telnet options: GMCP, CHARSET (forces UTF-8, `MudTelnet.cpp:281`),
  TTYPE, NAWS, MSSP (game time for the clock), SUPPRESS_GA/EOR,
  COMPRESS2 (MCCP) when zlib is present, LINEMODE/STATUS handling.
- On GMCP enable (`MudTelnet.cpp:515-552`):
  1. `Core.Hello {"client":"MMapper","version":…,"os":…}`
  2. `Core.Supports.Set` with the union of MMapper defaults and whatever the
     user client asked for (`MudTelnet.cpp:350-396`). Defaults
     (`MudTelnet.cpp:567-579`): `Char 1`, `Event 1`, `External.Discord 1`,
     `Group 1`, `Room.Chars 1`, `Room 1`, `MUME.Client 1`.
  3. **XML mode via GMCP:** `MUME.Client.XML {"enable": true, "silent": true}`.
- MUME's documented alternatives for XML mode: the `change xml` command, or
  the MPI escape `~$#EX1\n<state>\n` (states 0/1 off/on, 2/3 off/on
  without the confirmation) (<https://mume.org/help/change_xml>).
- **Remote editing is GMCP now**, not the old `~$#E` MPI: MUME sends
  `MUME.Client.Edit` / `MUME.Client.View`, the client replies with
  `MUME.Client.Write` / `MUME.Client.CancelEdit` (`src/mpi/mpifilter.cpp`,
  `MudTelnet.cpp:441-507`). MMapper hides all `MUME.Client.*` messages from
  the user client (`proxy.cpp:495-500`).

### 1.3 What it parses

**GMCP** (`src/parser/mumexmlparser-gmcp.cpp`):

| Message | Fields used | Purpose |
|---|---|---|
| `Room.Info` | `id`, `area`, `name`, `desc`, `environment`, `exits{dir:{id,name,flags}}` | room identity and matching, terrain, doors, exit flags |
| `Event.Moved` | `dir` | movement direction; also covers falls without a prompt |
| `Char.StatusVars` | `race` | troll exit mapping |
| `Char.Vitals` | fog/light/weather | prompt flags |
| `Group.*`, `Room.Chars.*` | | group manager, characters in room |

Field reference: <https://mume.org/help/gmcp_room>. `id` is optional
("not all rooms have numbers").

**XML** (`src/parser/mumexmlparser.cpp:139-440`): tags `room`, `name`,
`description`, `exits`, `prompt`, `terrain`, `header`, `weather`,
`status`, `snoop`, `/xml`. Tags are **stripped** before the text reaches
the user client, and `&lt; &gt; &amp;` are decoded. If XML mode is turned
off, MMapper prints "Mapper cannot function without XML mode"
(`mumexmlparser.cpp:239-243`). MUME has more tags that MMapper ignores
(`movement`, `magic`, `say`, `tell`, `narrate`, `hit`, `damage`, …; see
`change_xml` help).

**Prompt:** telnet GA/EOR marks a prompt (`AbstractTelnet.cpp:546-553`).
The parser stores the last prompt and derives prompt flags from it.

**Matching** (`src/pathmachine/pathmachine.cpp:232-260`): when the event
has a server id, look the room up by id. Otherwise ("historic maps and
mazes") run the classic path machine: exits, reverse exits, coordinates,
name/desc comparison (`docs/pathmachine.txt`). It also learns server ids
for neighbouring rooms from exit ids.

### 1.4 Map formats

- `.mm2`: binary Qt `QDataStream`, magic `0xFFB2AF01`, zlib/`qCompress`,
  schema versioned by date (`src/mapstorage/mapstorage.cpp`). Hard to read
  outside Qt.
- `.mm2xml` / `arda.xml`: XML, schema in `docs/mmapper_mm2xml.xsd`
  (`src/mapstorage/XmlMapStorage.cpp`). The default map is
  <https://github.com/MUME/arda> (`arda.xml`, schema tag `42`,
  `external/map/CMakeLists.txt`).
- **Web map export** (`src/mapstorage/jsonmapstorage.cpp`): `arda.json`
  metadata, `roomindex/<2-hex>.json` (MD5 of ASCII-normalised
  `name\ndesc` → coords), `zone/<x>_<y>.json` (20×20 zones with rooms:
  `x,y,z,id,name,desc,sector,light,…,exits[{flags,dflags,name,in,out}]`).
  It exists so a JS client can load only nearby zones. Play MUME adds a
  `serverindex.json` (server id → coords) via its own converter
  (`play-mume/src/tools/convert-map.ts`).

## 2. MMapper in the browser

- URL: <https://docs.mume.org/MMapper/demo/> (beta: `/MMapper/beta/`),
  docs page `MMapper/docs/web.md`. Built by
  `.github/workflows/build-wasm.yml` (Docker, Qt for WebAssembly).
- Artifacts: `mmapper.wasm` (36,612,049 bytes), `mmapper.js` (375 KB,
  Emscripten pthreads), `qtloader.js`, `coi-serviceworker.js` (injected by
  `cmake/WasmHtml.cmake` to get cross-origin isolation for
  `SharedArrayBuffer` on hosts that cannot set COOP/COEP headers).
- Connection (`src/proxy/mumesocket.cpp:434-481`): URL `wss://<server>:443/ws-play/`
  (server default `mume.org`), header `Sec-WebSocket-Protocol: binary`,
  `sendBinaryMessage` / `binaryMessageReceived` with raw telnet bytes
  (`TelnetIacBytes`), 1 ping per `PING_MILLIS` to keep proxies alive.
  Play MUME does the same: `new WebSocket(url, 'binary')`, `ArrayBuffer`
  sends (`play-mume/DecafMUD/src/js/decafmud.socket.websocket.js:127`).
- It **includes its own terminal client** (`src/client/`) and a password
  dialog (`Char.Login` over GMCP). It is a complete client, not a map
  widget.
- JS surface: only one `EM_JS` (browser OS detection,
  `MudTelnet.cpp:44`). No `EMSCRIPTEN_KEEPALIVE`/embind exports, no
  `postMessage` bridge. It is a full-page Qt canvas.

## 3. Integration options

### (a) Embed MMapper WASM in a pane, feed it our stream

How: iframe (or a same-page canvas) running a **patched** MMapper. The
patch adds a `MumeSocket` subclass whose bytes come from JS (our raw
inbound stream) and whose writes are dropped. It also needs a way to
pass on our outbound commands (for movement prediction). The user
side is attached to a null client. Glue: `postMessage` ↔ `EM_JS`/embind.

- Pros: exact MMapper behaviour (path machine, editing, infomarks, group
  sharing, look). Users can keep editing their own maps.
- Cons: needs a fork or an upstream PR, and a Qt-WASM toolchain in our
  build. It adds a 36 MB download and WebGL2, and needs cross-origin
  isolation (COOP/COEP or the service-worker hack) for **our** page too,
  because an iframe can only be isolated if its parent is. The Qt widget UI
  cannot match the TUI look. When the iframe has focus it takes the
  keyboard, which conflicts with Goal 8 (hotkeys). MMapper's `MudTelnet`
  will try to negotiate with a "MUD" that is really a tap, so its replies
  must be dropped and it must not send its own `Core.Supports.Set` /
  `MUME.Client.XML`. Our client must have requested XML already.
- Feasibility: medium. The proxy is already cleanly split by
  sockets/outputs; the patch is local (a new socket type plus JS glue). It
  can ship much later without changes to WebCockpit, **if** stage 1 keeps a
  raw byte tap (§5).

### (b) MMapper WASM as the proxy between WebCockpit and MUME

How: patch MMapper so our JS client replaces its internal `VirtualSocket`
client. Every byte then passes through MMapper.

- Pros: MMapper owns mapping and can inject its emulated exits etc., as in
  Cockpit's MMapper mode.
- Cons: latency and startup. A 36 MB module plus Qt boot sits on the
  critical path before the first byte, which conflicts with Goal 1. The
  client stops working if the map breaks. MMapper strips XML, takes over
  `_` commands, `MUME.Client.*` and `Core.Supports`. The GPL coupling is
  the tightest of all options. It needs the same patching as (a), plus
  more.
- Feasibility: technically possible, but a poor fit with the intent. **Not
  recommended.**

### (c) Own map renderer and pathing reading MMapper map data

How: a TS map module that loads `arda.xml` (or MMapper's web JSON export,
or a user's own exported map) into IndexedDB and renders on
canvas/WebGL in TUI style. It matches rooms by `Room.Info.id` first, then
by MD5(name+desc) like Play MUME and MMapper's web hasher, then by
exit-based prediction for id-less rooms.

- Pros: stays in our design language and latency budget. Small and fully
  under our control. No GPL obligation if written clean-room (formats and
  protocols are facts, not code). It works with GMCP alone.
- Cons: we write the rendering and pathfinding ourselves. Auto-mapping and
  map editing (MMapper's strength) are extra work; v1 could be read-only
  with "import updated map". Maze and id-less rooms need the fallback
  matcher. Map data licensing is its own issue (§4).
- Feasibility: high. Play MUME shows that the GMCP-only approach works in
  about 1,800 lines of TS (`play-mume/src/mume.mapper.ts`).

### (d) Other

- **Reuse Play MUME's mapper** (GPLv2+, PIXI.js, jQuery): the fastest
  route to a working map, but the whole map module becomes GPLv2+. Its
  `mapdata/v1` format is MMapper's JSON export and is a good target format
  for (c) even if we write the code ourselves.
- **MMapper's own web export** (File → export web map, `JsonMapStorage`):
  lets users feed their personal MMapper map into our map. Supporting this
  import in (c) costs little.
- **Desktop MMapper next to WebCockpit:** not possible without a local
  helper. The browser cannot open raw TCP to `localhost:4242`, and MMapper
  cannot accept WebSocket clients.
- **MMapper Web in a separate tab:** it would open a second MUME
  connection and login, so it is not an integration.

## 4. Licensing

MMapper is **GPL-2.0-or-later** (`COPYING.txt`, SPDX headers). Play MUME
is **GPLv2+** (it uses MMapper graphics, so no v3-only). DecafMUD is MIT.
`MUME/arda` has **no licence**: its README says it redistributes MUME's
copyrighted room texts under "fair use"; the Play MUME legal note calls
the map geometry "probably GPLv2".

- GPL duties apply on **distribution**. A private repo used only by the
  owner has none. **Serving the page to other users is distribution**:
  JS/WASM is sent to their browsers, unlike AGPL-style SaaS. So "private
  repo, public URL" still triggers GPL for any GPL component shipped.
- (a) iframe + `postMessage`: MMapper is shipped separately and talks at
  arm's length, which the FSF treats as mere aggregation. WebCockpit can
  keep its own licence. We must offer the source of our patched MMapper
  (a public fork is enough).
- (b) The same page calling exported functions and sharing internal data
  structures is at best arguable as a combined work. Assume WebCockpit
  would have to be GPL.
- (c) Clean-room: reading formats, protocols and documented behaviour is
  fine. Copying or translating MMapper/Play MUME code or its
  terrain/texture images is not; the images are GPLv2 (MMapper
  `external/images`). No constraint on WebCockpit's licence.
- (d) Reusing Play MUME code makes the map module (and likely the bundle)
  GPLv2+.
- Map data (all options): room names/descs belong to MUME. Do not bundle
  `arda.xml` in a public deploy without MUME's consent. Safer: the user
  imports a map file, or we load one from a MUME/MMapper-hosted URL
  (needs CORS; not verified).

## 5. What Cockpit relies on MMapper for (`/home/ole/MUME`)

- **Transport proxy and map window only.** tt++ connects to
  `localhost:4242` in `connection_mode=mmapper` (default), or directly to
  `mume.org:4242` over TLS (`docs/bridge-services.md:241`,
  `ttpp/core/config.tin`). No Cockpit feature parses MMapper's map or
  state.
- Connection state is driven by GMCP (`Char.Name` / `Core.Goodbye`)
  because the tt++ socket stays alive with MMapper while MUME drops (ADR
  0003). MMapper's text "Status: MUME closed the connection." is matched
  as a disconnect signal. Reconnect uses MMapper's `_disconnect` /
  `_connect` with a 1 s gap (ADR 0058, `ttpp/core/system.tin:29-47`).
- Cockpit sends `Core.Supports.Set ["Char 1","Comm.Channel 1","Event
  1","Core 1","Group 1"]` (`ttpp/core/gmcp.tin:24`). In MMapper mode,
  MMapper merges in `Room`, `Room.Chars`, `MUME.Client`. **In direct mode
  Cockpit never gets `Room.*`**. WebCockpit (always "direct") must
  subscribe itself.
- Cockpit does not use XML mode. MMapper strips it in MMapper mode.
- The clock logic is modelled on MMapper's `src/clock` (knowledge only,
  `docs/clock.md`).
- Lesson: in WebCockpit there is no proxy. The client owns the one
  connection, and the map is a pure consumer. None of the proxy
  workarounds in ADR 0003/0058 carry over.

## 6. Recommendation

**Option (c), with (a) kept open.** Build a native map pane after v1. It
reads MMapper's map formats (`arda.xml` and the MMapper/Play MUME web JSON
format, plus user-exported maps) and matches rooms by GMCP `Room.Info.id`,
with name/desc hash and exit prediction as fallbacks. This fits the TUI
look, the latency goal and licence freedom. The stage-1 constraints below
keep option (a) (a patched MMapper WASM in an iframe fed by our tap)
possible, so the final choice can wait until the map stage without
rework. Option (b) is rejected (latency, coupling, GPL).

**Verify before the spec is approved (owner-level risks):**

1. **Third-party origin:** does `wss://mume.org/ws-play/` accept a
   WebSocket handshake whose `Origin` is not a mume.org host? MMapper Web
   (`docs.mume.org`) and Play MUME (`mume.org`) are both first-party, and
   desktop MMapper is not a browser. Test: open the socket from a
   `localhost` page and check that the telnet negotiation (IAC WILL GMCP)
   arrives. Do not log in.
2. **MUME's stance:** Play MUME's README warns that self-hosted MUME web
   clients "encourage players to input their MUME passwords into random
   websites" and asks people to contact the Valar first. That affects the
   intent's "MUME not involved" constraint once others use the client.

## 7. Stage-1 architectural constraints

1. **One connection, owned by WebCockpit.** Open it with
   `new WebSocket('wss://mume.org/ws-play/', 'binary')`, set
   `binaryType = 'arraybuffer'`, and send only binary frames. Implement
   telnet ourselves. Nothing else, including a future map, opens its own
   MUME connection.
2. **Layered stream with public taps on one event bus**, in strict arrival
   order with a sequence number:
   - `raw.in` bytes after decompression and before telnet parsing, and
     `raw.out` bytes. Option (a) needs exactly this.
   - Telnet events: text chunks and lines, **prompt boundaries from
     GA/EOR**, GMCP (`name` + raw JSON string + parsed object), MSSP,
     option changes.
   - `cmd.out`: each command actually sent, after alias expansion and `;`
     splitting. The map uses it to predict movement.

   Ordering between GMCP and text must be kept: `Room.Info`,
   `Event.Moved` and the prompt interleave. Consumers are read-only and
   cannot delay the render path, so taps are cheap when nobody listens.
3. **Nothing is lost before the taps.** Gags, substitutes and highlights
   act on a derived display copy, never on the tapped stream. A gagged
   room description must still reach the map.
4. **XML mode support from stage 1.** Send `MUME.Client.XML
   {"enable":true,"silent":true}` after GMCP is up (the same as MMapper).
   The text pipeline strips tags, decodes `&lt; &gt; &amp;`, and attaches
   the tag structure (`room/name/description/exits/prompt/movement/weather/
   snoop/status` + comm tags) as line metadata. Triggers match on the clean
   text. Retrofitting XML later would change trigger semantics, so decide
   now. Recommended: on by default. It also helps comm-pane
   classification and prompt detection. A map built with (c) could work on
   GMCP alone; option (a) requires XML.
5. **GMCP module registry.** `Core.Supports.Set` replaces the whole set, so
   one registry builds it from all features. Baseline: `Core 1`, `Char 1`,
   `Event 1`, `Group 1`, `Comm.Channel 1`, **`Room 1`, `Room.Chars 1`,
   `MUME.Client 1`**. Send `Core.Hello` with the client name and version.
   The GMCP editor and handlers must never consume a message exclusively:
   every message reaches every subscriber.
6. **The client owns `MUME.Client.*`** (remote edit/view, XML toggle). The
   map never handles these.
7. **Telnet features:** GMCP, CHARSET (ask for UTF-8, fall back to
   Latin-1), NAWS, TTYPE, MSSP (game time for the clock), GA/EOR. MCCP is
   optional (`DecompressionStream('deflate')`); if used, taps sit after
   decompression.
8. **Pane host contract:** a pane can host a canvas/WebGL surface or an
   iframe, with resize events and a `postMessage` bridge. Global hotkeys
   must be defined for the case where an embedded frame has focus (focus
   returns to the input, or the frame forwards keys).
9. **Hosting and headers:** keep cross-origin isolation possible (COOP
   `same-origin`, COEP `require-corp`/`credentialless`). Self-host fonts
   and scripts, use no third-party embeds, and allow `'wasm-unsafe-eval'`
   and workers in any CSP. This keeps an MMapper WASM iframe viable.
10. **Storage:** profile storage uses IndexedDB with room for a separate
    `map` store (tens of MB) and user file import. Do not assume
    `localStorage` for bulk data.
11. **Licence hygiene:** no MMapper or Play MUME code or images in the core.
    The map lives behind a module boundary (a consumer of the bus plus a
    pane), so it can be swapped or licensed separately later.

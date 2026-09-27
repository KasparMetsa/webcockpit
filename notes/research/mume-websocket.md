# MUME WebSocket endpoint — research notes

Date: 2026-09-27. Status: verified empirically (raw handshakes + a real
headless Firefox page on `http://localhost:8080`).

## Verdict

**Yes — a static page on any origin can connect directly.**
`wss://mume.org/ws-play/` accepted the handshake (HTTP 101) for no Origin,
`http://localhost:8080`, `https://example.com` and `https://docs.mume.org`
alike. There is no Origin allow-list today. A real browser (Firefox headless,
page served from `http://localhost:8080`) opened the socket and received the
banner. The stream is raw telnet (IAC negotiation, GMCP, CHARSET, MCCP2) in
binary frames, so WebCockpit must implement a telnet layer itself.

Caveat: an open Origin policy is an operator choice, not a contract. MUME
could restrict it later (e.g. to `*.mume.org`). Fallback per `intent.md`:
contact MUME.

## 1. Endpoint

| Item | Value | Source |
|---|---|---|
| URL | `wss://mume.org/ws-play/` (port 443, trailing slash) | MMapper `src/proxy/mumesocket.cpp` (`url.setPath("/ws-play/")`, port 443, scheme `wss`); `MUME/play-mume` `src/index.ts` (`host: 'mume.org', wsport: 443, wspath: 'ws-play/', ssl: true`) |
| Subprotocol | `binary` (MMapper sets `Sec-WebSocket-Protocol: binary`). Server echoes it when offered; also works with no subprotocol (server then omits the header). | code + probe |
| Frames | Binary (opcode 2), both directions. MMapper uses `binaryMessageReceived` / `sendBinaryMessage`. | code + probe |
| Payload | Raw telnet byte stream, unmodified: IAC WILL/DO, subnegotiation, IAC GA after prompts. | probe |
| Extensions | None negotiated (`ws.extensions === ""` in Firefox; server declines permessage-deflate). Use MCCP2 for compression if wanted. | browser test |
| Default host in MMapper config | `mume.org` (`configuration.cpp`) | code |

Known browser clients using it:
- **MMapper Web (WASM)** — linked from `https://docs.mume.org/play/browser`,
  hosted at `https://docs.mume.org/MMapper/demo/` (GitHub Pages;
  `mume.github.io` 301-redirects there). On WASM MMapper forces the WebSocket
  transport (`advanceSocketType`: `if constexpr (Wasm) m_state = WEBSOCKET`).
- **Play MUME! (legacy, DecafMUD-based)** — `https://docs.mume.org/play-mume/`,
  repo `MUME/play-mume`. README: "MUME's official WebSocket URL at
  `https://mume.org/ws-play/`".

Both official clients live on `docs.mume.org`, i.e. cross-origin to
`mume.org` already, which is consistent with no strict Origin check.

## 2. Origin check — empirical

Script: `scratchpad/wsprobe.py` (handshake only, reads 2–3 s passively, sends a
close frame; no login, no game input). Five handshakes total, spaced out.

| Origin header | Subprotocol requested | Status | Response headers |
|---|---|---|---|
| (none) | binary | 101 | Sec-WebSocket-Accept, Sec-WebSocket-Protocol: binary, Connection: Upgrade, Upgrade: WebSocket |
| `http://localhost:8080` | binary | 101 | same |
| `https://example.com` | binary | 101 | same |
| `https://docs.mume.org` (known client origin) | binary | 101 | same |
| `https://docs.mume.org` | (none) | 101 | same minus Sec-WebSocket-Protocol |

Raw response (localhost origin):

```
HTTP/1.1 101 Switching Protocols
Sec-WebSocket-Accept: XM2+cfzzleeiIPncj1TXfEciFFI=
Sec-WebSocket-Protocol: binary
Connection: Upgrade
Upgrade: WebSocket
```

No `Server`, no CORS headers (not applicable to WS), no rate-limit headers.
Every case produced identical data (2 binary frames: 21 + 634 bytes).

Real browser confirmation (headless Firefox, page at `http://localhost:8080/`,
`new WebSocket('wss://mume.org/ws-play/', ['binary'])`):

```
open +554ms protocol=binary ext=
msg binary len=21 head=ff fd 1f ff fd 18 ff fd 2a ff fb 56 ff fb 46 ff fd 27 ff fb c9
msg binary len=634 head=0d 0a 20 20 20 ...
```

Note: `wss://` from an `http://localhost` page is fine; a deployed page should
be HTTPS (`ws://` would be mixed content, but we never use `ws://`).

## 3. Telnet / GMCP negotiation

First frame (21 bytes) is pure negotiation; banner follows in frame 2:

```
0000  ff fd 1f ff fd 18 ff fd 2a ff fb 56 ff fb 46 ff   ........*..V..F.
0010  fd 27 ff fb c9 0d 0a 20 20 20 20 20 20 20 20 20   .'.....
0030  20 20 20 20 20 20 2a 2a 2a 20 20 4d 55 4d 45 20         ***  MUME
0040  49 58 20 20 2a 2a 2a 0d 0a 0d 0a 20 20 20 20 20   IX  ***....
```

Decoded server offers:

| Bytes | Meaning |
|---|---|
| `ff fd 1f` | IAC DO NAWS |
| `ff fd 18` | IAC DO TTYPE |
| `ff fd 2a` | IAC DO CHARSET |
| `ff fb 56` | IAC WILL MCCP2 (COMPRESS2) |
| `ff fb 46` | IAC WILL MSSP |
| `ff fd 27` | IAC DO NEW-ENVIRON |
| `ff fb c9` | **IAC WILL GMCP** |
| `ff f9` (end of banner) | IAC GA after the login prompt |

One pre-login negotiation probe (`scratchpad/negprobe.py`, no game input):
client sent `IAC WILL CHARSET`, `IAC SB CHARSET REQUEST ";UTF-8;ISO-8859-1" IAC SE`,
`IAC DO GMCP`, `IAC DONT MCCP2`, `IAC DONT MSSP`, `IAC WONT NAWS/TTYPE/NEW-ENVIRON`,
GMCP `Core.Hello`, `Core.Supports.Set ["Char 1","Event 1","Room 1"]`,
`MUME.Client.XML {"enable":true,"silent":true}`. Server replied:

```
SB CHARSET: 01 ";ISO_8859-1:1987;ISO-8859-1;UTF-8;US-ASCII"   (server's own REQUEST)
SB CHARSET: 02 "UTF-8"                                          (ACCEPTED our request)
SB GMCP: Client.GUI {"url":"https://mume.org/download/clients/mudlet/mume_gui.mpackage","version":"1"}
SB GMCP: Client.Map {"url":"https://mume.org/download/mapper/arda-base.xml"}
```

So GMCP is live over the WebSocket before login, and UTF-8 is accepted via
RFC 2066 CHARSET. The server also sends its own CHARSET REQUEST; the client
must answer it (ACCEPTED UTF-8) or handle the collision per RFC 2066.
Without CHARSET negotiation the stream is Latin-1 (MUME's traditional
default). MMapper forces UTF-8 toward MUME (`MudTelnet` ctor:
`TextCodecStrategyEnum::FORCE_UTF_8`).

## 4. TLS, rate limits, per-IP

- TLS 1.3, `TLS_AES_256_GCM_SHA384`, ALPN http/1.1. Cert CN `mume.org`,
  Let's Encrypt (issuer `YR1`), notAfter 2026-11-10 (auto-renewed).
- No rate-limit headers or throttling seen over 6 connections. No documented
  limit found. Unknown whether the WS gateway limits connections per IP.
- MMapper sends a WS-level ping after 45 s of inactivity (`PING_MILLIS =
  45000`, timer restarted on every send/receive), which suggests idle WS
  connections may be dropped by the gateway. Browser JS cannot send WS ping
  frames, so WebCockpit needs an application-level keep-alive (e.g. GMCP
  `Core.Ping`, or a harmless telnet `IAC NOP`) at under 45 s idle. Actual
  idle timeout not measured.
- Per-IP: the WebSocket terminates at a gateway on mume.org, which then
  talks telnet to the game. Whether the game sees the player's real IP (for
  multi-play checks, site bans) is not verifiable pre-login. Since the
  official web clients use the same gateway, this is MUME's concern, not
  ours, but worth asking MUME if ever relevant.
- Server does not send `IAC WILL EOR`; prompts end with `IAC GA`.

### Measured 2026-09-27: round-trip times

From the owner's machine, pre-login, 16 samples alternating between the
two in-band methods:

| Method | RTT |
| --- | --- |
| ICMP ping to mume.org (what Cockpit's `Link` shows) | 31–37 ms |
| GMCP `Core.Ping` over the WebSocket | 82–249 ms |
| telnet `IAC DO TIMING-MARK` over the WebSocket | 48–261 ms |

Both in-band methods spread roughly uniformly over ~250 ms. This fits
MUME processing input on game-loop pulses of ~250 ms: a request waits
0–250 ms for the next pulse before it is answered. The minimum (~48 ms)
approximates network plus WebSocket gateway. This is a hypothesis, not
proven. Consequence: the `Link:` readout shows the minimum RTT over the
last 60 s of `Core.Ping` samples, not the last sample (ADR 0007).

## 5. XML mode and other options

- **XML mode:** enabled over GMCP, not the legacy `~$#EX` in-band handshake.
  MMapper (incl. the WASM build over this same WebSocket) sends
  `MUME.Client.XML {"enable": true, "silent": true}` right after
  `Core.Hello` in `MudTelnet::virt_onGmcpEnabled()`. Our probe sent it
  pre-login; the server did not reject it (with `silent` no ack is expected).
  XML tags only appear in game output after login, so final confirmation
  belongs in stage testing.
- MMapper's default GMCP modules (`resetGmcpModules`): Char 1, Event 1,
  External.Discord 1, Group 1, Room.Chars 1, Room 1, MUME.Client 1.
  MMapper also supports `Char.Login {name,password}` over GMCP.
- **MCCP2:** offered (`WILL COMPRESS2`). Usable in the browser via
  `DecompressionStream('deflate')` (zlib format). Optional; MMapper supports it.
- **NAWS / TTYPE / NEW-ENVIRON / MSSP:** offered/requested as in plain telnet.
  MMapper answers TTYPE with `"unknown"` toward MUME.
- Everything Cockpit does over tt++ telnet (`/home/ole/MUME/docs/gmcp.md`:
  `IAC DO GMCP`, `Core.Hello`, `Core.Supports.Set`) applies unchanged —
  the WS carries the same telnet stream.

## Implications for the spec

1. Transport: `new WebSocket('wss://mume.org/ws-play/', ['binary'])`,
   `binaryType = 'arraybuffer'`, send `Uint8Array`.
2. We need our own telnet parser (IAC escaping incl. `ff ff`, SB buffering
   across frame boundaries, GA as prompt marker), CHARSET → UTF-8, GMCP.
3. Optional MCCP2 via `DecompressionStream`.
4. Keep-alive needed; measure idle timeout in stage 1.
5. Origin policy is open today; record as an external dependency/risk in an ADR.

## Evidence files (scratchpad, not committed)

`/tmp/claude-1000/-home-ole-proj-webcockpit/71d1a0fe-f8d0-47e2-bae8-88b3846dfc08/scratchpad/`:
`wsprobe.py`, `negprobe.py`, `probe-*.txt`, `negprobe.txt`,
`browsertest/` (index.html, srv.py, result.txt), `mumesocket.cpp`,
`MudTelnet.cpp`, `AbstractTelnet.cpp`, `proxy.cpp` (fetched from MUME/MMapper).

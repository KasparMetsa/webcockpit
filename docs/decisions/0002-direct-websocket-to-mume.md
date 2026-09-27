# 0002 — Direct WebSocket connection to MUME

- Status: Accepted
- Date: 2026-09-27

## Context

intent.md requires no application server. Verified 2026-09-27 (see
`notes/research/mume-websocket.md`): `wss://mume.org/ws-play/` accepts
handshakes from any Origin (none, localhost, example.com, docs.mume.org),
and a real browser page on `http://localhost:8080` connected and received
the login banner. The socket carries a raw telnet byte stream in binary
frames; the server offers GMCP, MCCP2, MSSP, CHARSET and asks for NAWS,
TTYPE and NEW-ENVIRON.

## Decision

- The browser connects directly to `wss://mume.org/ws-play/` with
  subprotocol `binary`, binary frames, no proxy.
- WebCockpit implements its own telnet layer (IAC parsing, option
  negotiation, GMCP subnegotiation, CHARSET UTF-8, MCCP2 via
  `DecompressionStream('deflate')`, prompt detection on GA).
- A client-side keep-alive (e.g. GMCP `Core.Ping` or `IAC NOP`) is sent
  well under 45 s of idle, since browsers cannot send WebSocket pings.

## Consequences

- No server to host or pay for; each player connects from their own IP.
- The open Origin policy is MUME's current setup, not a promise. If MUME
  restricts it, the fallback (intent.md) is to contact MUME.
- XML mode (`MUME.Client.XML`) and idle timeout are confirmed in the
  first build stage, after login.

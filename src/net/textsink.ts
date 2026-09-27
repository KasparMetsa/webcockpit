// Contract between the telnet layer (src/net) and the line layer (src/text).

/**
 * Receives the decoded text stream from the telnet parser, in order.
 * Telnet commands are already stripped; `IAC IAC` has become a literal
 * character (Latin-1 `ÿ`). CR and LF are passed through as received.
 */
export interface TextSink {
  /** Decoded characters (CR, LF included as received), in order. */
  text(s: string, ts: number): void;
  /** IAC GA (or IAC EOR) seen at this point in the stream. */
  ga(ts: number): void;
}

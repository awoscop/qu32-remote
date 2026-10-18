/** Bridge to whatever owns the audio hardware (the Hub's audio engine). Absent in headless gateways. */
export interface AudioBridge {
  /** Browser sent an SDP offer for monitor slot `slotId`; return the SDP answer. */
  offer(slotId: number, sdp: string): Promise<string>;
  hangup(slotId: number): void;
  /** True while a phone is receiving audio for this slot. */
  streaming(slotId: number): boolean;
}

export const enum FrameType {
  Open = 1,
  Data = 2,
  Close = 3,
  Error = 4
}

const HEADER_LENGTH = 9;

export interface Frame {
  readonly type: FrameType;
  readonly sessionId: number;
  readonly payload: Buffer;
}

export function encodeFrame(type: FrameType, sessionId: number, payload?: Uint8Array): Buffer {
  const body = payload ? Buffer.from(payload) : Buffer.alloc(0);
  const frame = Buffer.allocUnsafe(HEADER_LENGTH + body.length);
  frame.writeUInt8(type, 0);
  frame.writeUInt32BE(sessionId, 1);
  frame.writeUInt32BE(body.length, 5);
  body.copy(frame, HEADER_LENGTH);
  return frame;
}

export class FrameReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Uint8Array, onFrame: (frame: Frame) => void): void {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);

    while (this.buffer.length >= HEADER_LENGTH) {
      const type = this.buffer.readUInt8(0);
      const sessionId = this.buffer.readUInt32BE(1);
      const payloadLength = this.buffer.readUInt32BE(5);
      const frameLength = HEADER_LENGTH + payloadLength;

      if (this.buffer.length < frameLength) {
        return;
      }

      const payload = this.buffer.subarray(HEADER_LENGTH, frameLength);
      this.buffer = this.buffer.subarray(frameLength);
      onFrame({ type: type as FrameType, sessionId, payload });
    }
  }
}

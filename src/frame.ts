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
  const _payload = payload ? Buffer.from(payload) : Buffer.alloc(0);
  const _frame = Buffer.allocUnsafe(HEADER_LENGTH + _payload.length);
  _frame.writeUInt8(type, 0);
  _frame.writeUInt32BE(sessionId, 1);
  _frame.writeUInt32BE(_payload.length, 5);
  _payload.copy(_frame, HEADER_LENGTH);
  return _frame;
}

export class FrameReader {
  private _buffer = Buffer.alloc(0);

  push(_chunk: Uint8Array, _onFrame: (_frame: Frame) => void): void {
    this._buffer = Buffer.concat([this._buffer, Buffer.from(_chunk)]);

    while (this._buffer.length >= HEADER_LENGTH) {
      const _type = this._buffer.readUInt8(0);
      const _sessionId = this._buffer.readUInt32BE(1);
      const _payloadLength = this._buffer.readUInt32BE(5);
      const _frameLength = HEADER_LENGTH + _payloadLength;

      if (this._buffer.length < _frameLength) {
        return;
      }

      const _payload = this._buffer.subarray(HEADER_LENGTH, _frameLength);
      this._buffer = this._buffer.subarray(_frameLength);

      _onFrame({
        type: _type as FrameType,
        sessionId: _sessionId,
        payload: _payload
      });
    }
  }
}

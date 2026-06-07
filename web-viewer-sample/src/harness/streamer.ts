// 串流引擎選擇器：harness 開啟用 FakeAppStreamer，否則用真實 AppStreamer。
// AppStream.tsx 一律經 getStreamer() 取用，harness 關閉時行為與原本逐一對等（prod 零變更）。
import { AppStreamer } from "@nvidia/omniverse-webrtc-streaming-library";
import { harnessEnabled } from "./harnessConfig";
import { FakeAppStreamer } from "./fakeStreamer";

export interface StreamerLike {
  // 對齊既有 AppStream 的鬆散 any 風格（lib 本身回 StreamEvent/any），避免在呼叫點製造型別摩擦。
  connect: (props: unknown) => Promise<any>;
  sendMessage: (message: unknown) => Promise<any>;
  terminate: (flag?: boolean) => unknown;
  resize: (width: number, height: number) => Promise<any>;
}

export function getStreamer(): StreamerLike {
  if (harnessEnabled()) {
    return FakeAppStreamer as StreamerLike;
  }
  return AppStreamer as unknown as StreamerLike;
}

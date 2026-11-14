/**
 * The iPad app (apps/ios) shows this same web app and adds a door to iOS: share sheet,
 * clipboard and printing. In a browser the door does not exist and nothing changes.
 */
type NativeMessage =
  | { action: "share"; text: string; url?: string }
  | { action: "shareFile"; name: string; text: string }
  | { action: "copy"; text: string }
  | { action: "print"; title: string };

interface NativeBridge {
  postMessage(message: NativeMessage): Promise<string>;
}

export const native: NativeBridge | undefined = (
  window as Window & { webkit?: { messageHandlers?: { native?: NativeBridge } } }
).webkit?.messageHandlers?.native;

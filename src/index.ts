import { createDeltaChatChannel } from "./channel.js";

export default function register(api: any) {
  const channel = createDeltaChatChannel();
  api.registerChannel(channel);
}

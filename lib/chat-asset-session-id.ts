const CHAT_ASSET_SESSION_ID_PATTERN = /^(usr_)?[a-f0-9]{32}$/;
const ANONYMOUS_SESSION_ID_PATTERN = /^[a-f0-9]{32}$/;

export function isChatAssetSessionId(value: string) {
  return CHAT_ASSET_SESSION_ID_PATTERN.test(value);
}

export function isAnonymousChatAssetSessionId(value: string) {
  return ANONYMOUS_SESSION_ID_PATTERN.test(value);
}

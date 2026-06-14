export const MODEL_GATE_VERSION_TAPS = 6;
export const MODEL_GATE_ENABLED_COOKIE = 'model_gate_enabled';
export const MODEL_GATE_UNLOCKED_COOKIE = 'model_gate_unlocked';
export const MODEL_GATE_TAP_COOKIE = 'model_gate_taps';

export const MODEL_GATE_MESSAGES = [
  '模型今天在午睡，先去连点 6 下版本号把它叫醒。',
  '访问口令暂时失踪了，试试猛点标题栏版本号 6 次。',
  '服务器说它要先看一段打节奏表演：请连点版本号 6 下。',
  '模型把门反锁了，连续敲 6 次 v1.0 才肯开门。',
  '今天的接入姿势不太传统，请先点击版本号 6 次完成热身。',
  '模型正在装酷，连点版本号 6 下之后它才愿意上班。',
] as const;

export function getRandomModelGateMessage() {
  return MODEL_GATE_MESSAGES[Math.floor(Math.random() * MODEL_GATE_MESSAGES.length)] || MODEL_GATE_MESSAGES[0];
}


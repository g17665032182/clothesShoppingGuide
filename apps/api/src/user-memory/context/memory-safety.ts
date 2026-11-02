const SENSITIVE_TEXT_PATTERN =
  /\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|social security|bank account|credit card|medical history|health condition|home address|phone number|passport|driver'?s license|diagnosis|medication|salary|income|debt)\b|sk-[a-z0-9]{16,}|密码|身份证|社保号|护照|驾驶证|病史|疾病|诊断|药物|住址|家庭住址|地址|邮箱|手机号码|电话号码|银行卡|信用卡|银行账户|工资|收入|债务/iu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const CHINA_PHONE_PATTERN = /(?:\+?86[-\s]?)?1[3-9]\d{9}/u;
const CHINA_ID_PATTERN = /\b\d{17}[\dXx]\b/u;
const NORTH_AMERICA_PHONE_PATTERN =
  /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/u;
const US_SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/u;
const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/u;

/** 只检查自由文本字段，避免把稳定类别枚举误判为敏感信息。 */
export function containsSensitiveMemoryText(value: unknown): boolean {
  const record =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const textValues = [
    record.label,
    record.notes,
    record.reason,
    ...(Array.isArray(record.items) ? record.items : []),
    ...(Array.isArray(record.terms) ? record.terms : []),
  ].filter((item): item is string => typeof item === 'string');

  return textValues.some(
    (text) =>
      SENSITIVE_TEXT_PATTERN.test(text) ||
      EMAIL_PATTERN.test(text) ||
      CHINA_PHONE_PATTERN.test(text) ||
      CHINA_ID_PATTERN.test(text) ||
      NORTH_AMERICA_PHONE_PATTERN.test(text) ||
      US_SSN_PATTERN.test(text) ||
      PAYMENT_CARD_PATTERN.test(text),
  );
}

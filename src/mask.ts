// 서버 측 마스킹. 프로젝트 측 마스킹을 신뢰하지 않고 저장과 프롬프트 투입 전에 한 번 더 적용한다.

const MASK = '[MASKED]';

const patterns: Array<[RegExp, string]> = [
  // Authorization 헤더, Bearer 토큰
  [/(authorization\s*[:=]\s*)(bearer\s+)?[^\s"',;]+/gi, `$1$2${MASK}`],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${MASK}`],
  // key=value 형태의 비밀 값. DB_PASSWORD, GITHUB_TOKEN처럼 앞뒤에 단어가 붙은 키도 포함한다
  [
    /\b((?:[A-Za-z0-9]+[_-])*(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|session(?:[_-]?id)?|cookie)(?:[_-][A-Za-z0-9]+)*["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    `$1${MASK}`,
  ],
  // 접속 문자열의 비밀번호 (postgres://user:pass@host)
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${MASK}@`],
  // 알려진 키 형식
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, MASK],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, MASK],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, MASK],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  [/\bci_[A-Za-z0-9_-]{20,}/g, MASK],
  // JWT
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MASK],
  // 개인정보: 이메일, 주민등록번호, 휴대폰 번호, 카드 번호
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, MASK],
  [/\b\d{6}-?[1-8]\d{6}\b/g, MASK],
  [/\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/g, MASK],
  [/\b(?:\d{4}[- ]?){3}\d{4}\b/g, MASK],
];

export function mask(text: string): string {
  let out = text;
  for (const [re, replacement] of patterns) out = out.replace(re, replacement);
  return out;
}

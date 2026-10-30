export const CAPTCHA_PROVIDER = Symbol('CAPTCHA_PROVIDER');

export interface CaptchaChallenge {
  challengeId: string;
  imageData: string;
  type: 'image';
}

export interface CaptchaProvider {
  issueChallenge(): Promise<CaptchaChallenge>;
  verifyChallenge(challengeId: string, answer: string): Promise<boolean>;
}

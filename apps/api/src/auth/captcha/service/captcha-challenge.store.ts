import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

interface CaptchaChallengeEntry {
  salt: Buffer;
  answerDigest: Buffer;
  expiresAt: number;
}

const MAX_CHALLENGES = 10_000;
const CHALLENGE_TTL_MS = 5 * 60 * 1_000;

export interface CaptchaChallengeStorePort {
  createId(): string;
  save(challengeId: string, answer: string): Promise<void>;
  consume(challengeId: string, answer: string): Promise<boolean>;
}

@Injectable()
export class CaptchaChallengeStore implements CaptchaChallengeStorePort {
  private readonly challenges = new Map<string, CaptchaChallengeEntry>();

  public createId(): string {
    return randomBytes(24).toString('base64url');
  }

  public async save(challengeId: string, answer: string): Promise<void> {
    this.removeExpired();
    if (this.challenges.size >= MAX_CHALLENGES) {
      const oldestChallengeId = this.challenges.keys().next().value;
      if (oldestChallengeId) this.challenges.delete(oldestChallengeId);
    }

    const salt = randomBytes(16);
    this.challenges.set(challengeId, {
      salt,
      answerDigest: this.digest(answer, salt),
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
  }

  public async consume(challengeId: string, answer: string): Promise<boolean> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return false;

    // 首次提交即移除挑战，正确和错误答案都不能重复尝试。
    this.challenges.delete(challengeId);
    if (challenge.expiresAt <= Date.now()) return false;

    const actualDigest = this.digest(answer, challenge.salt);
    return timingSafeEqual(challenge.answerDigest, actualDigest);
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [challengeId, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(challengeId);
    }
  }

  private digest(answer: string, salt: Buffer): Buffer {
    return createHash('sha256')
      .update(salt)
      .update(answer.trim().toLowerCase())
      .digest();
  }
}

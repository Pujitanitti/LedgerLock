import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKeySecret,
  parseRawApiKey,
  verifyApiKeySecret,
  verifyApiKeySecretAgainstPeppers,
} from './api-key-crypto';

describe('generateApiKey', () => {
  it('produces a key with the expected prefix and shape', () => {
    const { raw, publicId, secret } = generateApiKey();
    expect(raw).toBe(`${API_KEY_PREFIX}_${publicId}_${secret}`);
    expect(publicId).toMatch(/^[0-9a-f]{16}$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it('never generates the same raw key twice (collision-resistant)', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().raw));
    expect(keys.size).toBe(200);
  });

  it('generates a key that round-trips through parseRawApiKey', () => {
    const generated = generateApiKey();
    const parsed = parseRawApiKey(generated.raw);
    expect(parsed).toEqual({ publicId: generated.publicId, secret: generated.secret });
  });
});

describe('parseRawApiKey', () => {
  it('rejects a key with the wrong prefix', () => {
    const { publicId, secret } = generateApiKey();
    expect(parseRawApiKey(`ll_test_${publicId}_${secret}`)).toBeNull();
  });

  it('rejects a publicId that is too short', () => {
    const { secret } = generateApiKey();
    expect(parseRawApiKey(`ll_live_abc123_${secret}`)).toBeNull();
  });

  it('rejects a publicId containing non-hex characters', () => {
    const { secret } = generateApiKey();
    expect(parseRawApiKey(`ll_live_ggggggggggggggg_${secret}`)).toBeNull();
  });

  it('rejects a secret that is too short', () => {
    const { publicId } = generateApiKey();
    expect(parseRawApiKey(`ll_live_${publicId}_short`)).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseRawApiKey('')).toBeNull();
  });

  it('rejects a key missing the secret segment entirely', () => {
    const { publicId } = generateApiKey();
    expect(parseRawApiKey(`ll_live_${publicId}_`)).toBeNull();
  });

  it('rejects garbage input unrelated to the key format', () => {
    expect(parseRawApiKey('Bearer sometoken')).toBeNull();
    expect(parseRawApiKey('null')).toBeNull();
    expect(parseRawApiKey('undefined')).toBeNull();
  });

  it('tolerates surrounding whitespace from header parsing', () => {
    const { raw, publicId, secret } = generateApiKey();
    expect(parseRawApiKey(`  ${raw}  `)).toEqual({ publicId, secret });
  });

  it('correctly parses a secret that itself contains underscores and hyphens', () => {
    // base64url can legitimately contain '_' and '-'; the fixed-length
    // hex publicId group must still anchor parsing correctly.
    const publicId = '0123456789abcdef';
    const secret = 'a_b-c_d-e_f-g_h-i_j-k_l-m_n-o_p-q_r-s_t';
    const parsed = parseRawApiKey(`ll_live_${publicId}_${secret}`);
    expect(parsed).toEqual({ publicId, secret });
  });
});

describe('hashApiKeySecret', () => {
  it('is deterministic for the same secret and pepper', () => {
    const secret = 'some-secret-value';
    expect(hashApiKeySecret(secret, 'pepper-a')).toBe(hashApiKeySecret(secret, 'pepper-a'));
  });

  it('produces a different hash for a different pepper (pepper actually matters)', () => {
    const secret = 'some-secret-value';
    expect(hashApiKeySecret(secret, 'pepper-a')).not.toBe(hashApiKeySecret(secret, 'pepper-b'));
  });

  it('produces a different hash for a different secret', () => {
    expect(hashApiKeySecret('secret-a', 'pepper')).not.toBe(hashApiKeySecret('secret-b', 'pepper'));
  });

  it('produces a 64-character hex digest (SHA-256 output)', () => {
    expect(hashApiKeySecret('anything', 'pepper')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never includes the raw secret as a substring of its own hash', () => {
    const secret = 'a-fairly-distinctive-secret-value';
    expect(hashApiKeySecret(secret, 'pepper')).not.toContain(secret);
  });
});

describe('verifyApiKeySecret', () => {
  it('returns true for matching hashes', () => {
    const hash = hashApiKeySecret('secret', 'pepper');
    expect(verifyApiKeySecret(hash, hash)).toBe(true);
  });

  it('returns false for a completely different hash', () => {
    const a = hashApiKeySecret('secret-a', 'pepper');
    const b = hashApiKeySecret('secret-b', 'pepper');
    expect(verifyApiKeySecret(a, b)).toBe(false);
  });

  it('returns false when only a single character differs', () => {
    const hash = hashApiKeySecret('secret', 'pepper');
    const tampered = 'f' + hash.slice(1);
    expect(verifyApiKeySecret(tampered, hash)).toBe(false);
  });

  it('returns false rather than throwing when lengths differ', () => {
    const hash = hashApiKeySecret('secret', 'pepper');
    expect(() => verifyApiKeySecret('short', hash)).not.toThrow();
    expect(verifyApiKeySecret('short', hash)).toBe(false);
  });

  it('returns false for two empty strings without throwing (degenerate input)', () => {
    expect(() => verifyApiKeySecret('', '')).not.toThrow();
  });
});

describe('verifyApiKeySecretAgainstPeppers — pepper rotation (R-003)', () => {
  it('verifies against the current pepper when there is only one', () => {
    const secret = 'my-secret';
    const currentHash = hashApiKeySecret(secret, 'current-pepper');
    expect(verifyApiKeySecretAgainstPeppers(secret, currentHash, ['current-pepper'])).toBe(true);
  });

  it('verifies a key hashed under the OLD pepper during a rotation window', () => {
    const secret = 'my-secret';
    const oldHash = hashApiKeySecret(secret, 'old-pepper');
    // Current pepper has already been rotated to 'new-pepper', but the
    // previous one is still configured as a fallback.
    expect(verifyApiKeySecretAgainstPeppers(secret, oldHash, ['new-pepper', 'old-pepper'])).toBe(true);
  });

  it('tries peppers in order and succeeds on the first match without needing all of them to match', () => {
    const secret = 'my-secret';
    const newHash = hashApiKeySecret(secret, 'new-pepper');
    expect(verifyApiKeySecretAgainstPeppers(secret, newHash, ['new-pepper', 'old-pepper'])).toBe(true);
  });

  it('fails when the secret matches neither the current nor the previous pepper', () => {
    const secret = 'my-secret';
    const hash = hashApiKeySecret(secret, 'some-unrelated-pepper');
    expect(verifyApiKeySecretAgainstPeppers(secret, hash, ['new-pepper', 'old-pepper'])).toBe(false);
  });

  it('fails safely (no throw) for an empty peppers list', () => {
    const secret = 'my-secret';
    const hash = hashApiKeySecret(secret, 'pepper');
    expect(() => verifyApiKeySecretAgainstPeppers(secret, hash, [])).not.toThrow();
    expect(verifyApiKeySecretAgainstPeppers(secret, hash, [])).toBe(false);
  });

  it('does not verify against the old pepper once rotation is complete and it is no longer configured', () => {
    const secret = 'my-secret';
    const oldHash = hashApiKeySecret(secret, 'old-pepper');
    // Rotation window has ended — only the current pepper remains configured.
    expect(verifyApiKeySecretAgainstPeppers(secret, oldHash, ['new-pepper'])).toBe(false);
  });
});

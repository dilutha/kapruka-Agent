import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from '@jest/globals';
import { GuestTokenService } from './security.config';
import { InputSanitizationPipe } from './security.middleware';

describe('GuestTokenService', () => {
  const service = new GuestTokenService(
    new ConfigService({
      GUEST_TOKEN_SECRET: 'a'.repeat(64),
    }),
  );

  it('generates a verifiable guest token', () => {
    const token = service.generate();

    expect(service.verify(token)).toMatchObject({ valid: true });
  });

  it('rejects a tampered guest token', () => {
    const token = service.generate();
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    expect(service.verify(tampered)).toEqual({ valid: false });
  });
});

describe('InputSanitizationPipe', () => {
  it('sanitizes nested request body strings', () => {
    const pipe = new InputSanitizationPipe();

    expect(
      pipe.transform(
        {
          content: '  <script>alert(1)</script>Hello\u0000  ',
          nested: { value: '<b>World</b>' },
        },
        { type: 'body', metatype: undefined, data: undefined },
      ),
    ).toEqual({
      content: 'alert(1)Hello',
      nested: { value: 'World' },
    });
  });
});

import z from 'zod/v4'
import { testSchemaConverter } from '../../tests/shared'

testSchemaConverter([
  {
    name: 'string',
    schema: z.string(),
    input: [true, { type: 'string' }],
  },
  {
    name: 'string.min(5).max(10).regex(/^[a-z\\]+$/)',
    schema: z.string().min(5).max(10).regex(/^[a-z\\]+$/),
    input: [true, { type: 'string', maxLength: 10, minLength: 5, pattern: '^[a-z\\\\]+$' }],
  },
  {
    name: 'string.min(5).max(10).regex(/^[a-z\\]+$/).regex(/^[bcd\\]+$/)',
    schema: z.string().min(5).max(10).regex(/^[a-z\\]+$/).regex(/^[bcd\\]+$/),
    input: [true, { type: 'string', maxLength: 10, minLength: 5, pattern: '^[a-z\\\\]+$', allOf: [{ pattern: '^[bcd\\\\]+$' }] }],
  },
  {
    name: 'base64',
    schema: z.base64(),
    input: [true, { type: 'string', contentEncoding: 'base64' }],
  },
  {
    name: 'cuid',
    schema: z.cuid(),
    input: [true, { type: 'string', pattern: '^[cC][0-9a-z]{6,}$' }],
  },
  {
    name: 'email',
    schema: z.email(),
    input: [true, { type: 'string', format: 'email' }],
  },
  {
    name: 'url',
    schema: z.url(),
    input: [true, { type: 'string', format: 'uri' }],
  },
  {
    name: 'uuid',
    schema: z.uuid(),
    input: [true, { type: 'string', format: 'uuid' }],
  },
  {
    name: 'string.length(6)',
    schema: z.string().length(6),
    input: [true, { type: 'string', minLength: 6, maxLength: 6 }],
  },
  {
    name: 'string.min(8).length(5)',
    schema: z.string().min(8).length(5),
    input: [true, { type: 'string', minLength: 8, maxLength: 5 }],
  },
  {
    name: 'string.includes("a\\")',
    schema: z.string().includes('a\\'),
    input: [true, { type: 'string', pattern: 'a\\\\' }],
  },
  {
    name: 'string.startsWith("a\\")',
    schema: z.string().startsWith('a\\'),
    input: [true, { type: 'string', pattern: '^a\\\\.*' }],
  },
  {
    name: 'string.endsWith("a\\")',
    schema: z.string().endsWith('a\\'),
    input: [true, { type: 'string', pattern: '.*a\\\\$' }],
  },
  {
    name: 'emoji',
    schema: z.emoji(),
    input: [true, { type: 'string', pattern: '^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$' }],
  },
  {
    name: 'uuid',
    schema: z.uuid(),
    input: [true, { type: 'string', format: 'uuid' }],
  },
  {
    name: 'guid',
    schema: z.guid(),
    input: [true, { type: 'string', format: 'uuid' }],
  },
  {
    name: 'nanoid',
    schema: z.nanoid(),
    input: [true, { type: 'string', pattern: '^[a-zA-Z0-9_-]{21}$' }],
  },
  {
    name: 'cuid2',
    schema: z.cuid2(),
    input: [true, { type: 'string', pattern: '^[0-9a-z]+$' }],
  },
  {
    name: 'ulid',
    schema: z.ulid(),
    input: [true, {
      type: 'string',
      pattern: '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$',
    }],
  },
  {
    name: 'iso.datetime',
    schema: z.iso.datetime(),
    input: [true, { type: 'string', format: 'date-time' }],
  },
  {
    name: 'iso.date',
    schema: z.iso.date(),
    input: [true, { type: 'string', format: 'date' }],
  },
  {
    name: 'iso.time',
    schema: z.iso.time(),
    input: [true, { type: 'string', format: 'time' }],
  },
  {
    name: 'iso.duration',
    schema: z.iso.duration(),
    input: [true, { type: 'string', format: 'duration' }],
  },
  {
    name: 'ipv4',
    schema: z.ipv4(),
    input: [true, { type: 'string', format: 'ipv4' }],
  },
  {
    name: 'ipv6',
    schema: z.ipv6(),
    input: [true, {
      type: 'string',
      format: 'ipv6',
    }],
  },
  {
    name: 'jwt',
    schema: z.jwt(),
    input: [true, { type: 'string', pattern: '^[\\w-]+\\.[\\w-]+\\.[\\w-]+$' }],
  },
  {
    name: 'base64url',
    schema: z.base64url(),
    input: [true, { type: 'string', pattern: '^[A-Za-z0-9_-]*$' }],
  },
  {
    name: 'string.trim()',
    schema: z.string().trim(),
    input: [true, { type: 'string' }],
  },
  {
    name: 'templateLiteral(z.number(), z.enum(["px", "em", "rem", "%"]))',
    schema: z.templateLiteral([z.number(), z.enum(['px', 'em', 'rem', '%'])]) as any,
    input: [true, { type: 'string', pattern: '^-?\\d+(?:\\.\\d+)?(px|em|rem|%)$' }],
  },
  {
    name: 'z.hash("md5")',
    schema: z.hash('md5'),
    input: [true, { type: 'string', pattern: '^[0-9a-fA-F]{32}$' }],
  },
  {
    name: 'z.hash("sha256", { enc: "base64" })',
    schema: z.hash('sha256', { enc: 'base64' }),
    input: [true, { type: 'string', pattern: '^[A-Za-z0-9+/]{43}=$' }],
  },
])

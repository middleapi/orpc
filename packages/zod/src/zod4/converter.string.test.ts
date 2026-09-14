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
    input: [true, { type: 'string', minLength: 5, maxLength: 10, pattern: '^[a-z\\\\]+$' }],
  },
  {
    name: 'string.min(5).max(10).regex(/^[a-z\\]+$/).regex(/^[bcd\\]+$/)',
    schema: z.string().min(5).max(10).regex(/^[a-z\\]+$/).regex(/^[bcd\\]+$/),
    input: [true, { type: 'string', minLength: 5, maxLength: 10, allOf: [{ pattern: '^[a-z\\\\]+$' }, { pattern: '^[bcd\\\\]+$' }] }],
  },
  {
    name: 'base64',
    schema: z.base64(),
    input: [true, { type: 'string', contentEncoding: 'base64', format: 'base64', pattern: '^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$' }],
  },
  {
    name: 'cuid',
    schema: z.cuid(),
    input: [true, { type: 'string', format: 'cuid', pattern: '^[cC][0-9a-z]{6,}$' }],
  },
  {
    name: 'email',
    schema: z.email(),
    input: [true, { type: 'string', format: 'email', pattern: '^(?:[A-Za-z0-9_\'+\\-]+\\.)*[A-Za-z0-9_\'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$' }],
  },
  {
    name: 'url',
    schema: z.url(),
    input: [true, { type: 'string', format: 'uri' }],
  },
  {
    name: 'uuid',
    schema: z.uuid(),
    input: [true, { type: 'string', format: 'uuid', pattern: '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' }],
  },
  {
    name: 'string.length(6)',
    schema: z.string().length(6),
    input: [true, { type: 'string', minLength: 6, maxLength: 6 }],
  },
  {
    name: 'string.includes("a\\")',
    schema: z.string().includes('a\\'),
    input: [true, { type: 'string', format: 'includes', pattern: 'a\\\\' }],
  },
  {
    name: 'string.startsWith("a\\")',
    schema: z.string().startsWith('a\\'),
    input: [true, { type: 'string', format: 'starts_with', pattern: '^a\\\\.*' }],
  },
  {
    name: 'string.endsWith("a\\")',
    schema: z.string().endsWith('a\\'),
    input: [true, { type: 'string', format: 'ends_with', pattern: '.*a\\\\$' }],
  },
  {
    name: 'emoji',
    schema: z.emoji(),
    input: [true, { type: 'string', format: 'emoji', pattern: '^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$' }],
  },
  {
    name: 'uuid',
    schema: z.uuid(),
    input: [true, { type: 'string', format: 'uuid', pattern: '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' }],
  },
  {
    name: 'guid',
    schema: z.guid(),
    input: [true, { type: 'string', format: 'uuid', pattern: '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$' }],
  },
  {
    name: 'nanoid',
    schema: z.nanoid(),
    input: [true, { type: 'string', format: 'nanoid', pattern: '^[a-zA-Z0-9_-]{21}$' }],
  },
  {
    name: 'cuid2',
    schema: z.cuid2(),
    input: [true, { type: 'string', format: 'cuid2', pattern: '^[0-9a-z]+$' }],
  },
  {
    name: 'ulid',
    schema: z.ulid(),
    input: [true, {
      type: 'string',
      format: 'ulid',
      pattern: '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$',
    }],
  },
  {
    name: 'iso.datetime',
    schema: z.iso.datetime(),
    input: [true, { type: 'string', format: 'date-time', pattern: '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$' }],
  },
  {
    name: 'iso.date',
    schema: z.iso.date(),
    input: [true, { type: 'string', format: 'date', pattern: '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$' }],
  },
  {
    name: 'iso.time',
    schema: z.iso.time(),
    input: [true, { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?$' }],
  },
  {
    name: 'iso.duration',
    schema: z.iso.duration(),
    input: [true, { type: 'string', format: 'duration', pattern: '^P(?:(\\d+W)|(?!.*W)(?=\\d|T\\d)(\\d+Y)?(\\d+M)?(\\d+D)?(T(?=\\d)(\\d+H)?(\\d+M)?(\\d+([.,]\\d+)?S)?)?)$' }],
  },
  {
    name: 'ipv4',
    schema: z.ipv4(),
    input: [true, { type: 'string', format: 'ipv4', pattern: '^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$' }],
  },
  {
    name: 'ipv6',
    schema: z.ipv6(),
    input: [true, {
      type: 'string',
      format: 'ipv6',
      pattern: '^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$',
    }],
  },
  {
    name: 'jwt',
    schema: z.jwt(),
    input: [true, { type: 'string', format: 'jwt' }],
  },
  {
    name: 'base64url',
    schema: z.base64url(),
    input: [true, { type: 'string', contentEncoding: 'base64url', format: 'base64url', pattern: '^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$' }],
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
    input: [true, { type: 'string', format: 'md5_hex', pattern: '^[0-9a-fA-F]{32}$' }],
  },
  {
    name: 'z.hash("sha256", { enc: "base64" })',
    schema: z.hash('sha256', { enc: 'base64' }),
    input: [true, { type: 'string', format: 'sha256_base64', pattern: '^[A-Za-z0-9+/]{43}=$' }],
  },
])

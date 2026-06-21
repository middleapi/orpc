# Bracket Notation

Bracket notation encodes structured data in flat key-value formats such as query strings and form data. [OpenAPI Serializer](/docs/openapi/serializer), [OpenAPI Handler](/docs/openapi/handler), and [OpenAPI Link](/docs/openapi/link) use it whenever nested data must be represented outside plain JSON.

## Rules

1. **Repeated keys become arrays.**

   ```
   color=red&color=blue -> { color: ['red', 'blue'] }
   ```

2. **Append `[]` to push into an array.**

   ```
   color[]=red&color[]=blue -> { color: ['red', 'blue'] }
   ```

3. **Append `[number]` to target an explicit array index.**

   ```
   color[0]=red&color[2]=blue -> { color: ['red', <empty>, 'blue'] }
   ```

   ::: info
   Missing indexes create sparse arrays.

   Explicit indexes greater than `999` are treated as object keys by default to avoid huge sparse arrays during deserialization. To change that limit, configure `maxExplicitDeserializingArrayIndex`:

   ```ts
   const serializer = new OpenAPISerializer({
     bracketNotation: {
       maxExplicitDeserializingArrayIndex: 1999,
     }
   })
   ```

   :::

4. **Append `[key]` to target an object property.**

   ```
   color[red]=true&color[blue]=false -> { color: { red: 'true', blue: 'false' } }
   ```

## Limitations

Bracket notation is designed to express structured data in constrained environments, so it has a few unavoidable limitations:

- Cannot represent empty structures like empty objects `{}` or empty arrays `[]`.
- Cannot represent an array at the root level. For example, `0=red&1=blue` becomes `{ 0: 'red', 1: 'blue' }`, not `['red', 'blue']`.
- Cannot represent objects whose keys are all numbers, because they can be mistaken for array indexes.

::: info
If bracket notation is used in query strings or form data, it also inherits the limitations of those formats. For example, values are always strings or files, and `null` or `undefined` cannot be represented.
:::

## Examples

### URL Query

```bash
curl 'http://example.com/api/example?name[first]=John&name[last]=Doe'
```

This query is parsed as:

```json
{
  "name": {
    "first": "John",
    "last": "Doe"
  }
}
```

### Form Data

```bash
curl -X POST http://example.com/api/example \
  -F 'name[first]=John' \
  -F 'name[last]=Doe'
```

This form data is parsed as:

```json
{
  "name": {
    "first": "John",
    "last": "Doe"
  }
}
```

### Complex Example

```bash
curl -X POST http://example.com/api/example \
  -F 'data[names][0][first]=John1' \
  -F 'data[names][0][last]=Doe1' \
  -F 'data[names][1][first]=John2' \
  -F 'data[names][1][last]=Doe2' \
  -F 'data[ages][0]=18' \
  -F 'data[ages][2]=25' \
  -F 'data[files][]=@/path/to/file1' \
  -F 'data[files][]=@/path/to/file2'
```

This form data is parsed as:

```json
{
  "data": {
    "names": [
      { "first": "John1", "last": "Doe1" },
      { "first": "John2", "last": "Doe2" }
    ],
    "ages": ["18", "<empty>", "25"],
    "files": ["<binary data>", "<binary data>"]
  }
}
```

## Learn More

The bracket notation is a small, self-contained module, making it easy to understand.
To explore its behavior in detail, see the [source code](https://github.com/middleapi/orpc/blob/main/packages/openapi/src/bracket-notation.ts).

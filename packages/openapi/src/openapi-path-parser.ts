export class OpenAPIPathParser {
  parseDynamicParams(path: string): { name: string, raw: string }[] {
    const raws = path.match(/\{([^}]+)\}/g) ?? []

    return raws.map((raw) => {
      const name = raw.slice(1, -1).split(':')[0]! // : can be used in the future for more complex routing
      return { name, raw }
    })
  }
}

export type PublicOpenAPIPathParser = Pick<OpenAPIPathParser, keyof OpenAPIPathParser>

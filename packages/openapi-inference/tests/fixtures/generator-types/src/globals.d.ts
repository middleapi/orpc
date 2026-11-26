// a shorthand ambient module, which declares no body
declare module 'generator-shorthand'

// a nested namespace, whose declaration nests the declaration of `Nested` as its body
declare namespace GeneratorModels.Nested {
  type Id = string
  interface Item {
    id: Id
  }
}

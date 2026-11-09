/**
 * Only imported as a type: the test runtime does not run `accessor` fields,
 * `round25.ts` builds the same instances with a getter and setter on the prototype.
 */
export class AccessorModel {
  accessor x = 1
  y = 2
}

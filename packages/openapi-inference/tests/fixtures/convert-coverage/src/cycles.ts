/** A model holding itself, and a view of itself that holds itself again */
export interface Node {
  self: Node
  view: Partial<Node>
}

/**
 * The view converted at the root, which comes back to itself through the model, and then once
 * more directly, without a named type between
 */
export declare const partialNode: Partial<Node>

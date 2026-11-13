/* oxlint-disable typescript/no-wrapper-object-types -- views of a boxed boolean with a toJSON */
import { os, type } from '@orpc/server'

/** Interfaces extending a view of a set or a map, written by their own fields when `toJSON` returns them */
export interface LabeledView extends Readonly<Set<string>> {
  label: string
}

export interface SizedSet extends Pick<Set<string>, 'size'> {
  label: string
}

export interface LabeledMap extends Readonly<Map<string, number>> {
  label: string
}

export interface SizedMap extends Pick<Map<string, number>, 'size'> {
  label: string
}

export class LabeledViewOwner {
  toJSON(): LabeledView {
    return Object.assign(new Set(['a']), { label: 'l' })
  }
}

export interface LabeledViews {
  owner: LabeledViewOwner
  error: Error & { toJSON(): LabeledView }
  sized: Error & { toJSON(): SizedSet }
  map: Error & { toJSON(): LabeledMap }
  sizedMap: Error & { toJSON(): SizedMap }
}

const errorJson = <T>(json: T) => Object.assign(new Error('x'), { toJSON: () => json })

export const labeledViews = (): LabeledViews => ({
  owner: new LabeledViewOwner(),
  error: errorJson(Object.assign(new Set(['a']), { label: 'l' })),
  sized: errorJson(Object.assign(new Set(['a']), { label: 'l' })),
  map: errorJson(Object.assign(new Map([['a', 1]]), { label: 'l' })),
  sizedMap: errorJson(Object.assign(new Map([['a', 1]]), { label: 'l' })),
})

/** A plain object may also hold the field a view copies from the built-in */
export const plainLabeledViews = (): LabeledViews => ({
  ...labeledViews(),
  sized: errorJson({ size: 1, label: 'l' }),
  sizedMap: errorJson({ size: 1, label: 'l' }),
})

/** Plain views of a boxed boolean, which the serializer walks */
export interface BooleanViews {
  relay: Pick<Boolean, 'valueOf'> & { toJSON(): (() => number) & { toJSON(): number } }
  text: Pick<Boolean, 'valueOf'> & { toJSON(): string }
  none: Pick<Boolean, 'valueOf'> & { toJSON(): () => void }
}

export const booleanViews = (): BooleanViews => ({
  relay: { valueOf: () => true, toJSON: () => Object.assign(() => 1, { toJSON: () => 2 }) },
  text: { valueOf: () => true, toJSON: () => 't' },
  none: { valueOf: () => true, toJSON: () => () => {} },
})

export const collectionViews = {
  labeledViewOwner: os.handler((): LabeledViewOwner => new LabeledViewOwner()),
  labeledViews: os.handler(labeledViews),
  plainLabeledViews: os.handler(plainLabeledViews),
  booleanViews: os.handler(booleanViews),
  booleanViewRoot: os.handler((): Readonly<{ f: BooleanViews['relay'] }> => ({
    f: booleanViews().relay,
  })),
}

export const collectionViewsInputs = {
  labeledViews: os.input(type<LabeledViews>()).handler(() => 1),
  booleanViews: os.input(type<BooleanViews>()).handler(() => 1),
}

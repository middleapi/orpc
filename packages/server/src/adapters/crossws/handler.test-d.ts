import type { Peer } from 'crossws'
import type { CrosswsPeerLike } from './handler'

it('crossws Peer is assignable to CrosswsPeerLike', () => {
  const _assignable: CrosswsPeerLike = {} as Peer
})

it('a peer without bufferedAmount and waitForDrain is assignable to CrosswsPeerLike', () => {
  const _assignable: CrosswsPeerLike = {} as Pick<Peer, 'send'>
})

// oxlint-disable-next-line import/no-unassigned-import
import '@orpc/openapi/extensions/route'
import { os, type } from '@orpc/server'

export type SuccessStatus = 200 | 201
export enum HttpStatus {
  Ok = 200,
  Created = 201,
}
export interface CreatedHeaders {
  location: string
}
export interface Item {
  id: string
}
export interface GetParams {
  id: string
}
export interface ListQuery {
  limit?: number
}
export interface DetailedInput {
  params: GetParams
  query: ListQuery
  headers: CreatedHeaders
  body: Item
}

export const router = {
  aliasStatus: os
    .route({ method: 'POST', path: '/alias', outputStructure: 'detailed' })
    .handler((): { status: SuccessStatus; headers: CreatedHeaders; body: Item } => null as any),
  enumStatus: os
    .route({ method: 'POST', path: '/enum', outputStructure: 'detailed' })
    .handler((): { status: HttpStatus; body: Item } => null as any),
  sections: os
    .route({ method: 'PATCH', path: '/sections/{id}', inputStructure: 'detailed' })
    .input(type<DetailedInput>())
    .handler(() => 1),
}

import { fillORPCErrorJsonStatus, getDynamicParams, standardizeHTTPPath } from './utils'

it('standardizeHTTPPath', () => {
  expect(standardizeHTTPPath('/path')).toBe('/path')
  expect(standardizeHTTPPath('/path/')).toBe('/path')
  expect(standardizeHTTPPath('/path//to/something')).toBe('/path/to/something')
  expect(standardizeHTTPPath('//path//to//something//')).toBe('/path/to/something')
})

it('getDynamicParams', () => {
  expect(getDynamicParams(undefined)).toBe(undefined)
  expect(getDynamicParams('/path')).toBe(undefined)
  expect(getDynamicParams('/path/{id}')).toEqual([{ raw: '/{id}', name: 'id' }])
  expect(getDynamicParams('/path/{id}/{name}')).toEqual([{ raw: '/{id}', name: 'id' }, { raw: '/{name}', name: 'name' }])
  expect(getDynamicParams('/path/{name}/{+id}')).toEqual([{ raw: '/{name}', name: 'name' }, { raw: '/{+id}', name: 'id' }])
  expect(getDynamicParams('/path//{+id}//something{+name}//')).toEqual([{ raw: '/{+id}', name: 'id' }])
})

it('fillORPCErrorJsonStatus', () => {
  const v2Json = { defined: true, code: 'NOT_FOUND', message: 'message', data: 'data' }

  expect(fillORPCErrorJsonStatus(v2Json, 409)).toEqual({ ...v2Json, status: 409 })
  expect(fillORPCErrorJsonStatus(v2Json)).toEqual({ ...v2Json, status: 404 })
  expect(fillORPCErrorJsonStatus({ ...v2Json, code: 'CUSTOM' })).toEqual({ ...v2Json, code: 'CUSTOM', status: 500 })

  const v1Json = { ...v2Json, status: 410 }
  expect(fillORPCErrorJsonStatus(v1Json, 409)).toBe(v1Json)

  expect(fillORPCErrorJsonStatus('body', 409)).toBe('body')
  expect(fillORPCErrorJsonStatus(undefined, 409)).toBe(undefined)
  expect(fillORPCErrorJsonStatus({ something: 'data' }, 409)).toEqual({ something: 'data' })
})

it('exports DEFAULT_ERROR_STATUS_CODE', async () => {
  await expect(import('./constants')).resolves.toMatchObject({
    DEFAULT_ERROR_STATUS: 400,
    DEFAULT_SUCCESS_STATUS: 200,
  })
})

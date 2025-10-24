import z from 'zod'

export const PingSchema = z.string().describe('The word that comes after ping')
export const PingVoidSchema = z.void().describe('A void input')

import { Endpoint } from 'payload'

export const createOrder: Endpoint = {
  path: '/create',
  method: 'post',

  handler: async (req) => {
    const { data } = await (req as any).json()
    return Response.json(data)
  }
}
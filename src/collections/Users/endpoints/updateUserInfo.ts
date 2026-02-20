import { Endpoint, PayloadRequest } from 'payload'

type UpdateUserInfo = {
  name?: string
  surname?: string
  phone?: string
  city?: string
  street?: string
}

export const updateUserInfo: Endpoint = {
  path: '/update',
  method: 'patch',

  handler: async (req: PayloadRequest) => {
    if (!req.user) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 })
    }
    const { name, surname, phone, city, street } = await req?.json?.()

    const dataToUpdate: UpdateUserInfo = {}
    if (name !== undefined) dataToUpdate.name = name
    if (surname !== undefined) dataToUpdate.surname = surname
    if (phone !== undefined) dataToUpdate.phone = phone
    if (city !== undefined) dataToUpdate.city =city
    if (street !== undefined) dataToUpdate.street = street

    const updatedUser = await req.payload.update({
      collection: 'users',
      id: req.user.id,
      data: dataToUpdate,
    })

    return Response.json(updatedUser)
  },
}

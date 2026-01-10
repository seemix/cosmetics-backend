import { Field } from 'payload'

export const hideStockFields = (fields: Field[]): any => {
  return fields.map((field) => {
    if (field.type === 'group' || 'name' in field && field.name === 'inventory') {
      return {
        ...field,
        admin: {
          ...(field.admin || {}),
          hidden: true,
        },
      }
    }
    return field
  })
}
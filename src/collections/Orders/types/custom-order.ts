import { Product } from '@/payload-types'

export type OrderItem = {
  product: string | Product
  quantity: number
  price: number
  id?: string
}

export type ShippingAddress = {
  name: string
  surname: string
  phone: string
  email: string
  city: string
  address: string
}

export type CustomOrder = {
  id: string
  orderNumber: string
  items: OrderItem[]
  total: number
  status: 'pending' | 'paid' | 'shipped' | 'cancelled'
  shippingAddress: ShippingAddress
  comment?: string
  createdAt?: string
  updatedAt?: string
}
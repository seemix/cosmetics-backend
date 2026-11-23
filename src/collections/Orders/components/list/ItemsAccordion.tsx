'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { AnimateHeight, ChevronIcon } from '@payloadcms/ui'

import './ordersList.css'

/** Плавне розгортання переліку товарів у списку замовлень, як у формі редагування. */
export const ItemsAccordion = ({ summary, children }: { summary: string; children: ReactNode }) => {
  const [open, setOpen] = useState(false)

  return (
    <div className="orders-list-items">
      <button
        type="button"
        className="orders-list-items__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{summary}</span>
        <span className={`orders-list-items__chevron${open ? ' orders-list-items__chevron--open' : ''}`}>
          <ChevronIcon />
        </span>
      </button>
      <AnimateHeight height={open ? 'auto' : 0} className="orders-list-items__content">
        {children}
      </AnimateHeight>
    </div>
  )
}

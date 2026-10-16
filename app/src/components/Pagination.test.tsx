import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Pagination from './Pagination'

const baseProps = {
  page: 1,
  totalPages: 3,
  pageSize: 10,
  total: 25,
  countOnPage: 10,
  disabled: false,
  onPageChange: vi.fn(),
}

describe('Pagination', () => {
  it('shows the result range summary', () => {
    render(<Pagination {...baseProps} />)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–10 of 25 results')
  })

  it('computes the range from the last partial page', () => {
    render(<Pagination {...baseProps} page={3} countOnPage={5} />)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 21–25 of 25 results')
  })

  it('renders numbered buttons for small page counts', () => {
    render(<Pagination {...baseProps} />)
    for (const label of ['1', '2', '3']) {
      expect(screen.getByRole('button', { name: `Go to page ${label}` })).toBeInTheDocument()
    }
  })

  it('windows long page lists with ellipses', () => {
    render(<Pagination {...baseProps} page={6} totalPages={12} total={120} />)
    expect(screen.getByRole('button', { name: 'Go to page 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to page 5' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to page 7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to page 12' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go to page 3' })).not.toBeInTheDocument()
    expect(screen.getAllByText('…').length).toBe(2)
  })

  it('marks the current page', () => {
    render(<Pagination {...baseProps} page={2} />)
    const current = screen.getByRole('button', { name: 'Go to page 2' })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveClass('pagination-page--current')
  })

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(<Pagination {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

    rerender(<Pagination {...baseProps} page={3} />)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('fires onPageChange with the target page', () => {
    const onPageChange = vi.fn()
    render(<Pagination {...baseProps} page={2} onPageChange={onPageChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(onPageChange).toHaveBeenNthCalledWith(1, 3)
    expect(onPageChange).toHaveBeenNthCalledWith(2, 1)
  })

  it('ignores clicks while disabled', () => {
    const onPageChange = vi.fn()
    render(<Pagination {...baseProps} page={1} disabled onPageChange={onPageChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }))
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('renders nothing when there are no results', () => {
    const { container } = render(<Pagination {...baseProps} total={0} totalPages={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})

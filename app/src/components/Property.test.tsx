import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeItem } from '../test/fixtures'
import Property from './Property'

describe('Property', () => {
  it('shows address, price, and bedrooms', () => {
    render(<Property listing={makeItem()} rankOnPage={1} />)
    expect(screen.getByText('1 First St')).toBeInTheDocument()
    expect(screen.getByText('Springfield, VA 22150')).toBeInTheDocument()
    expect(screen.getByText('$500,000')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows the relevance score and its breakdown', () => {
    render(<Property listing={makeItem()} rankOnPage={1} />)
    expect(screen.getByText('95.9')).toBeInTheDocument()
    expect(screen.getByText('relevance')).toBeInTheDocument()
    expect(screen.getByText(/Budget fit 97%/)).toBeInTheDocument()
    expect(screen.getByText(/Recency 94%/)).toBeInTheDocument()
    expect(screen.getByText(/listed 3 days ago/)).toBeInTheDocument()
  })

  it('omits budget fit when the server did not rank by budget', () => {
    render(
      <Property
        listing={makeItem({ scoreBreakdown: { budgetFit: null, recency: 0.5, ageDays: 30 } })}
        rankOnPage={2}
      />,
    )
    expect(screen.getByText(/Recency 50%/)).toBeInTheDocument()
    expect(screen.queryByText(/Budget fit/)).not.toBeInTheDocument()
  })

  it('renders the overall rank within the full result set', () => {
    render(<Property listing={makeItem()} rankOnPage={14} />)
    expect(screen.getByText('#14')).toBeInTheDocument()
  })

  it('bands the score: high at 60+, medium at 30+, low below', () => {
    const { rerender } = render(<Property listing={makeItem({ score: 80 })} rankOnPage={1} />)
    expect(screen.getByText('80.0').closest('.score-badge')).toHaveClass('score-badge--high')

    rerender(<Property listing={makeItem({ score: 45.2 })} rankOnPage={1} />)
    expect(screen.getByText('45.2').closest('.score-badge')).toHaveClass('score-badge--medium')

    rerender(<Property listing={makeItem({ score: 12 })} rankOnPage={1} />)
    expect(screen.getByText('12.0').closest('.score-badge')).toHaveClass('score-badge--low')
  })

  it('handles missing optional data gracefully', () => {
    render(
      <Property
        listing={makeItem({
          sqft: null,
          listedDate: null,
          description: null,
          scoreBreakdown: { budgetFit: null, recency: 0.5, ageDays: null },
        })}
        rankOnPage={1}
      />,
    )
    expect(screen.getByText(/Listed date unknown/)).toBeInTheDocument()
    expect(document.querySelector('.score-breakdown')).toHaveTextContent('date unknown')
    expect(screen.queryByText(/sqft/)).not.toBeInTheDocument()
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_DRAFT } from '../validation'
import type { SearchDraft } from '../validation'
import SearchForm from './SearchForm'

function draft(overrides: Partial<SearchDraft> = {}): SearchDraft {
  return { ...EMPTY_DRAFT, ...overrides }
}

function renderForm(overrides: Partial<Parameters<typeof SearchForm>[0]> = {}) {
  const props = {
    draft: draft(),
    errors: {},
    cities: ['Fairfax', 'Reston'],
    citiesLoading: false,
    onDraftChange: vi.fn(),
    onSubmit: vi.fn(),
    onReset: vi.fn(),
    disabled: false,
    ...overrides,
  }
  const utils = render(<SearchForm {...props} />)
  return { props, ...utils }
}

describe('SearchForm', () => {
  it('renders every filter input', () => {
    renderForm()
    expect(screen.getByLabelText('Min price')).toBeInTheDocument()
    expect(screen.getByLabelText('Max price')).toBeInTheDocument()
    expect(screen.getByLabelText('Target budget')).toBeInTheDocument()
    expect(screen.getByLabelText('Min bedrooms')).toBeInTheDocument()
    expect(screen.getByLabelText('City')).toBeInTheDocument()
    expect(screen.getByLabelText('Keyword in description')).toBeInTheDocument()
    expect(screen.getByLabelText('Results per page')).toBeInTheDocument()
  })

  it('populates the city dropdown, with Any city as the default', () => {
    renderForm()
    const city = screen.getByLabelText('City')
    expect(screen.getByRole('option', { name: 'Any city' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Fairfax' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Reston' })).toBeInTheDocument()
    expect((city as HTMLSelectElement).value).toBe('')
  })

  it('reports input changes through onDraftChange', async () => {
    const user = userEvent.setup()
    const { props } = renderForm()

    await user.type(screen.getByLabelText('Min price'), '5')
    expect(props.onDraftChange).toHaveBeenCalledWith('minPrice', '5')

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Reston' } })
    expect(props.onDraftChange).toHaveBeenLastCalledWith('city', 'Reston')
  })

  it('submits through onSubmit without a page reload', () => {
    const { props } = renderForm()
    fireEvent.submit(screen.getByRole('button', { name: 'Search listings' }))
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('also submits when the user presses Enter in a text field', () => {
    const { props } = renderForm()
    const input = screen.getByLabelText('Min price') as HTMLInputElement
    fireEvent.submit(input.form as HTMLFormElement)
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('resets through onReset', () => {
    const { props } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(props.onReset).toHaveBeenCalledTimes(1)
  })

  it('shows inline errors with invalid styling and aria wiring', () => {
    renderForm({
      errors: { minPrice: 'Minimum price cannot be greater than maximum price (400,000).' },
      draft: draft({ minPrice: '600000', maxPrice: '400000' }),
    })
    const input = screen.getByLabelText('Min price')
    expect(screen.getByRole('alert')).toHaveTextContent('cannot be greater than')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(/cannot be greater than/)
    expect(input.closest('.field')).toHaveClass('field--invalid')
  })

  it('shows multiple field errors at once', () => {
    renderForm({
      errors: { minPrice: 'bad', keyword: 'too long' },
    })
    expect(screen.getByText('bad')).toBeInTheDocument()
    expect(screen.getByText('too long')).toBeInTheDocument()
  })

  it('shows a hint while cities are loading', () => {
    renderForm({ cities: [], citiesLoading: true })
    expect(screen.getByText('Loading cities…')).toBeInTheDocument()
  })

  it('disables the submit button while disabled', () => {
    renderForm({ disabled: true })
    expect(screen.getByRole('button', { name: 'Search listings' })).toBeDisabled()
  })
})

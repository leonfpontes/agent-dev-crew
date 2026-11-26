import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './App'

afterEach(cleanup)

describe('App', () => {
  it('renders the title and the replay badge from Atlas UI', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Agent Dev Crew' })).toBeTruthy()
    expect(screen.getByText('Replay mode').getAttribute('data-slot')).toBe('badge')
  })
})

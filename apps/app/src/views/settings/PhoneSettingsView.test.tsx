/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { PhoneTab } from './PhoneSettingsView.js';
afterEach(cleanup);
function Remote() { const location = useLocation(); return <h1>{location.pathname}{location.hash}</h1>; }
it('redirects old Mobile links to the shared Remote access instructions', async () => {
  render(<MemoryRouter initialEntries={['/settings/phone']}><Routes><Route path="/settings/phone" element={<PhoneTab />} /><Route path="/settings/remote-access" element={<Remote />} /></Routes></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: '/settings/remote-access#phone.browser-guide' })).toBeTruthy();
  expect(screen.queryByText('Coming soon')).toBeNull();
});

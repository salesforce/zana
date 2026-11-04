import { Navigate } from 'react-router-dom';

/** Compatibility route: phone browsers use the same Remote access address. */
export function PhoneView() {
  return <Navigate to="/settings/remote-access#phone.browser-guide" replace />;
}

export { PhoneView as PhoneTab };

import { useLocation, useNavigate } from 'react-router-dom';
import { useUi } from '../../store.js';
import { setupPath, useSetupPages, type SetupRequest } from './setup-pages.js';

export function useSetupNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return (request: SetupRequest) => {
    const id = useSetupPages
      .getState()
      .open(request, location.pathname + location.search + location.hash);
    if (id) void navigate(setupPath(id));
    else
      useUi
        .getState()
        .pushToast('Close a setup tab before opening another', 'error');
  };
}
